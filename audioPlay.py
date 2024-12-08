import sys
import bisect
from PyQt5.QtWidgets import (
    QApplication, QWidget, QPushButton, QLabel, QTextBrowser, QFileDialog,
    QVBoxLayout, QHBoxLayout, QSlider, QStyle, QMessageBox, QButtonGroup, QLineEdit, QScrollArea
)
from PyQt5.QtMultimedia import QMediaPlayer, QMediaContent
from PyQt5.QtCore import (
    QUrl, QTimer, Qt, pyqtSignal, QThread, QEvent, 
    QRect, QRectF, QSize, QSemaphore, QPoint
)
from PyQt5.QtGui import (
    QTextCursor, QTextCharFormat, QColor, QFont, QPainter, QPainterPath,
    QPalette
)
import assemblyai as aai
import json
import os
import hashlib
from pathlib import Path
from translationGemini import translate_text
import httpx
import time
import logging

# 在文件开头设置日志配置
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

class SubtitleUpdateThread(QThread):
    update_signal = pyqtSignal(float)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.running = True
        self.paused = False
        self._force_update = False

    def force_update(self):
        """强制触发一次更新"""
        self._force_update = True

    def run(self):
        while self.running:
            if not self.paused or self._force_update:
                current_time = self.parent().media_player.position()
                self.update_signal.emit(current_time)
                self._force_update = False
            time.sleep(0.1)

    def stop(self):
        self.running = False

    def pause(self):
        self.paused = True

    def resume(self):
        self.paused = False

class TranscriptionThread(QThread):
    transcription_done = pyqtSignal(object)
    error_occurred = pyqtSignal(str)

    def __init__(self, audio_file, api_key):
        super().__init__()
        self.audio_file = audio_file
        self.api_key = api_key

    def run(self):
        try:
            aai.settings.api_key = self.api_key
            transcriber = aai.Transcriber()
            config = aai.TranscriptionConfig(speaker_labels=True)
            transcript = transcriber.transcribe(self.audio_file, config=config)
            self.transcription_done.emit(transcript)
        except Exception as e:
            self.error_occurred.emit(str(e))

class TranslationThread(QThread):
    translation_done = pyqtSignal(int, str, str)  # (index, translation, translator_type)
    progress_updated = pyqtSignal(int, int)  # (current_count, total_count)

    def __init__(self, index, text, translator_type, api_key, semaphore):
        super().__init__()
        self.index = index
        self.text = text
        self.translator_type = translator_type
        self.api_key = api_key
        self.semaphore = semaphore
        self.is_running = True

    def run(self):
        try:
            self.semaphore.acquire()
            if not self.is_running:
                return

            translation = ""
            logging.info(f"开始翻译 [ID:{self.index}] - 使用{self.translator_type}翻译器")

            if self.translator_type == 'silicon_cloud':
                import translationSiliconCloud
                translation = translationSiliconCloud.translate_to_chinese(
                    self.text,
                    api_key=self.api_key,
                    base_url='https://api.siliconflow.cn/v1'
                )
            elif self.translator_type == 'google':
                # 添加Google翻译支持
                import translationGoogle
                translation = translationGoogle.google_translate(self.text)
            else:  # gemini
                translation = translate_text(self.text)

            if translation:
                logging.info(f"翻译成功 [ID:{self.index}] - {self.translator_type}")
                self.translation_done.emit(self.index, translation, self.translator_type)
            else:
                raise Exception("Empty translation result")

        except Exception as e:
            logging.error(f"翻译失败 [ID:{self.index}] - {self.translator_type}: {str(e)}")
        finally:
            self.semaphore.release()

    def stop(self):
        self.is_running = False

class ModernMacTextBrowser(QTextBrowser):
    """macOS 风格文本浏览器"""
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setStyleSheet("""
            QTextBrowser {
                background-color: #FFFFFF;
                border: 1px solid #E5E5E5;
                border-radius: 8px;
                padding: 12px;
                selection-background-color: #007AFF40;
            }
            QScrollBar:vertical {
                border: none;
                background: transparent;
                width: 8px;
                margin: 4px 0;
            }
            QScrollBar::handle:vertical {
                background: #9999A5;
                border-radius: 4px;
                min-height: 30px;
            }
            QScrollBar::handle:vertical:hover {
                background: #666666;
            }
            QScrollBar::add-line:vertical, 
            QScrollBar::sub-line:vertical {
                height: 0px;
            }
            QScrollBar::add-page:vertical,
            QScrollBar::sub-page:vertical {
                background: none;
            }
        """)
        
        # 设置默认字体
        font = self.font()
        font.setFamily(".AppleSystemUIFont")
        font.setPointSize(13)
        self.setFont(font)
        
        # 保存滚动位置
        self.last_scroll_position = 0
        
        # 添加滚动相关属性
        self.smooth_scroll_timer = QTimer(self)
        self.smooth_scroll_timer.timeout.connect(self.smooth_scroll_step)
        self.target_scroll_position = 0
        self.current_scroll_position = 0
        self.scroll_step_size = 10
        
    def save_scroll_position(self):
        """保存当前滚动位置"""
        self.last_scroll_position = self.verticalScrollBar().value()
        
    def restore_scroll_position(self):
        """恢复之前的滚动位置"""
        self.verticalScrollBar().setValue(self.last_scroll_position)
        
    def smooth_scroll_to_position(self, position):
        """平滑滚动到指定位置"""
        self.target_scroll_position = position
        self.current_scroll_position = self.verticalScrollBar().value()
        
        if not self.smooth_scroll_timer.isActive():
            self.smooth_scroll_timer.start(16)  # 约60fps
            
    def smooth_scroll_step(self):
        """执行平滑滚动的单个步骤"""
        if abs(self.current_scroll_position - self.target_scroll_position) < 1:
            self.smooth_scroll_timer.stop()
            self.verticalScrollBar().setValue(self.target_scroll_position)
            return
            
        # 使用缓动函数使滚动更平滑
        self.current_scroll_position += (self.target_scroll_position - self.current_scroll_position) * 0.2
        self.verticalScrollBar().setValue(int(self.current_scroll_position))
        
    def get_visible_block_range(self):
        """获取当前可见的文本块范围"""
        viewport_height = self.viewport().height()
        first_visible = self.firstVisibleBlock()
        last_visible = self.cursorForPosition(QPoint(0, viewport_height)).block()
        
        return first_visible.blockNumber(), last_visible.blockNumber()

class ModernMacButton(QPushButton):
    """macOS 风格按钮"""
    def __init__(self, text="", parent=None, accent=False, checkable=False):
        super().__init__(text, parent)
        self.accent = accent
        self.setFixedHeight(32)
        self.setCursor(Qt.PointingHandCursor)
        self.setCheckable(checkable)
        self.setStyleSheet(self._get_style())
        
    def _get_style(self):
        if self.accent:
            return """
                QPushButton {
                    background-color: #007AFF;
                    color: white;
                    border: none;
                    border-radius: 6px;
                    padding: 0 16px;
                    font-family: "SF Pro Text";
                    font-weight: 500;
                }
                QPushButton:hover {
                    background-color: #0051D5;
                }
                QPushButton:pressed, QPushButton:checked {
                    background-color: #0040A8;
                }
                QPushButton:disabled {
                    background-color: #E5E5E5;
                    color: #999999;
                }
            """
        else:
            return """
                QPushButton {
                    background-color: #F5F5F7;
                    color: #1D1D1F;
                    border: none;
                    border-radius: 6px;
                    padding: 0 16px;
                    font-family: "SF Pro Text";
                    font-weight: 500;
                }
                QPushButton:hover {
                    background-color: #E5E5E7;
                }
                QPushButton:pressed, QPushButton:checked {
                    background-color: #D5D5D7;
                    color: #007AFF;
                }
                QPushButton:disabled {
                    color: #999999;
                }
            """

class ModernMacSlider(QSlider):
    """macOS 风格滑"""
    def __init__(self, orientation=Qt.Horizontal, parent=None):
        super().__init__(orientation, parent)
        self.setStyleSheet("""
            QSlider {
                min-height: 24px;  /* 增加高显示完整的滑 */
            }
            QSlider::groove:horizontal {
                border: none;
                height: 4px;
                background: #E5E5E5;
                border-radius: 2px;
                margin: 0 0;  /* 移除上下边距 */
            }
            QSlider::handle:horizontal {
                background: #007AFF;
                border: none;
                width: 16px;
                height: 16px;
                margin: -6px 0;
                border-radius: 8px;
            }
            QSlider::handle:horizontal:hover {
                background: #0051D5;
            }
        """)

    def mousePressEvent(self, event):
        """处理鼠标点击事件"""
        if event.button() == Qt.LeftButton:
            value = QStyle.sliderValueFromPosition(
                self.minimum(), self.maximum(), 
                event.x(), self.width()
            )
            self.setValue(value)
            self.sliderMoved.emit(value)
        super().mousePressEvent(event)

class ModernMacToggleButton(QPushButton):
    """macOS 风格开关按钮"""
    def __init__(self, text="", parent=None):
        super().__init__(text, parent)
        self.setCheckable(True)
        self.setFixedHeight(32)
        self.setCursor(Qt.PointingHandCursor)
        self.setStyleSheet("""
            QPushButton {
                background-color: #F5F5F7;
                color: #1D1D1F;
                border: none;
                border-radius: 6px;
                padding: 0 16px;
                font-family: "SF Pro Text";
                font-weight: 500;
            }
            QPushButton:hover {
                background-color: #E5E5E7;
            }
            QPushButton:checked {
                background-color: #007AFF;
                color: white;
            }
            QPushButton:checked:hover {
                background-color: #0051D5;
            }
        """)

class ScrollingLabel(QLabel):
    """可滚动的标签"""
    def __init__(self, text="", parent=None):
        super().__init__(text, parent)
        self.scroll_pos = 0
        self.scroll_timer = QTimer(self)
        self.scroll_timer.timeout.connect(self.update_scroll)
        self.scroll_direction = 1
        self.setStyleSheet("""
            QLabel {
                color: #666666;
                padding: 0 12px;
                font-family: ".AppleSystemUIFont";
            }
        """)

    def enterEvent(self, event):
        if self.sizeHint().width() > self.width():
            self.scroll_timer.start(50)

    def leaveEvent(self, event):
        self.scroll_timer.stop()
        self.scroll_pos = 0
        self.update()

    def update_scroll(self):
        if self.sizeHint().width() > self.width():
            max_scroll = self.sizeHint().width() - self.width() + 24
            self.scroll_pos += self.scroll_direction * 2
            
            if self.scroll_pos >= max_scroll:
                self.scroll_pos = max_scroll
                self.scroll_direction = -1
            elif self.scroll_pos <= 0:
                self.scroll_pos = 0
                self.scroll_direction = 1
            
            self.update()

    def paintEvent(self, event):
        """自定义绘制事件"""
        painter = QPainter(self)
        try:
            painter.setRenderHint(QPainter.Antialiasing)
            
            # 使用QRectF
            rect = QRectF(self.rect())
            
            # 创建裁剪区域
            path = QPainterPath()
            path.addRoundedRect(rect, 6.0, 6.0)
            painter.setClipPath(path)
            
            # 绘制文本
            painter.drawText(
                rect.adjusted(-self.scroll_pos, 0, 0, 0),
                Qt.AlignVCenter | Qt.AlignLeft, 
                self.text()
            )
        finally:
            painter.end()

    def sizeHint(self):
        return QSize(
            self.fontMetrics().horizontalAdvance(self.text()) + 24,
            super().sizeHint().height()
        )

class ModernProgressBar(QWidget):
    """macOS风格进度条"""
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFixedHeight(32)
        self.progress = 0
        self.total = 0
        self.message = ""
        
    def set_progress(self, current, total, message=""):
        self.progress = current
        self.total = total
        self.message = message
        self.update()
        
    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        
        # 绘制背景
        bg_rect = self.rect().adjusted(0, 8, 0, -8)
        painter.setPen(Qt.NoPen)
        painter.setBrush(QColor("#F5F5F7"))
        painter.drawRoundedRect(bg_rect, 8, 8)
        
        # 绘制进度
        if self.total > 0:
            progress_width = int((self.progress / self.total) * bg_rect.width())
            progress_rect = QRect(bg_rect.x(), bg_rect.y(), progress_width, bg_rect.height())
            painter.setBrush(QColor("#007AFF"))
            painter.drawRoundedRect(progress_rect, 8, 8)
        
        # 绘制文本
        if self.message:
            painter.setPen(QColor("#1D1D1F"))
            painter.setFont(QFont(".AppleSystemUIFont", 12))
            painter.drawText(self.rect(), Qt.AlignCenter, self.message)

class PodcastPlayer(QWidget):
    def __init__(self):
        super().__init__()
        # 设置窗口属性
        self.setWindowTitle('播客播放器')
        self.resize(900, 700)
        self.setStyleSheet("""
            QWidget {
                background-color: #FFFFFF;
                font-family: ".AppleSystemUIFont";
            }
            QLabel {
                color: #1D1D1F;
                font-size: 14px;
            }
        """)
        
        # 初始化媒体播放器 - 移到前面
        self.media_player = QMediaPlayer()
        self.media_player.error.connect(self.handle_media_error)
        self.media_player.positionChanged.connect(self.position_changed)
        self.media_player.durationChanged.connect(self.duration_changed)
        
        # 初始化基本属性
        self.subtitles = []
        self.subtitle_times = []
        self.subtitle_positions = []
        self.current_subtitle_index = -1
        self.total_duration = 0
        self.word_positions = []
        self.current_word_index = -1
        self.api_key = "598726265a7e46e1b39e683b46378ad6"
        self.gemini_api_key = ""

        # 添加数据存储相关的初始化
        self.data_dir = Path("podcast_data")
        self.data_dir.mkdir(exist_ok=True)
        self.subtitle_cache_dir = self.data_dir / "subtitles"
        self.subtitle_cache_dir.mkdir(exist_ok=True)
        self.audio_index_file = self.data_dir / "audio_index.json"
        
        # 先加载音频索引
        self.load_audio_index()
        
        # 添加翻译相关属
        self.translations = {}  # 于存储翻译结果
        self.translation_thread = None
        
        # 添加新的属性
        self.update_thread = None
        self.last_update_time = 0
        self.update_interval = 100  # 100ms的更新间隔
        self.last_subtitle_index = -1
        self.last_word_index = -1

        # 添加配置文件相关
        self.config_file = self.data_dir / "config.json"
        self.load_config()  # 加载配置
        
        # 添加定时器用于处理悬停事件
        self.hover_timer = QTimer(self)
        self.hover_timer.setSingleShot(True)  # 单次触发
        self.hover_timer.timeout.connect(self.show_api_key)
        
        # 添加scroll_timer属性初始化
        self.scroll_timer = QTimer(self)
        
        # 修改进度条初始化
        self.progress_bar = ModernProgressBar()
        self.progress_bar.setFixedHeight(32)
        self.progress_bar.setVisible(False)  # 设置为不可见但保留空间
        
        # 添加中文字幕显示控制
        self.show_translation = True
        
        # 最后初始化UI
        self.init_ui()

        # 初始化更新线程 - 移到最后
        self.initialize_update_thread()

        self.translation_threads = []  # 保存翻译线程的引用
        self.current_translation_count = 0
        self.total_translation_count = 0

        # 添字幕点击事件处理
        self.subtitle_display.mousePressEvent = self.on_subtitle_clicked

        self.subtitle_blocks = []  # 存储字幕块的位置信息
        self.pending_translations = {}  # 存储待处理的翻译结果
        
        self.current_display_index = 0  # 当前显示的字幕索引
        self.display_timer = QTimer()
        self.display_timer.timeout.connect(self.display_next_subtitle)
        self.display_interval = 100  # 100ms显示一条字幕

        # 添信号量，限制同时进行的翻译线程数量
        self.translation_semaphore = QSemaphore(5)  # 最多允许5个线程同时翻译

        # 添加SiliconCloud API Key
        self.silicon_cloud_api_key = ""
        
        # 修改配置相关属性
        self.config_file = self.data_dir / "config.json"
        self.load_config()
        
        # 添加滑块状态变量
        self.is_seeking = False
        
        self.translation_progress = {}  # 用于跟踪翻译进度
        self.translation_semaphore = QSemaphore(3)  # 限制并发翻译数量

    def load_audio_index(self):
        """加载音频索引文件"""
        if self.audio_index_file.exists():
            with open(self.audio_index_file, 'r', encoding='utf-8') as f:
                self.audio_index = json.load(f)
        else:
            self.audio_index = {}
            self.save_audio_index()

    def save_audio_index(self):
        """保存音频索引文件"""
        with open(self.audio_index_file, 'w', encoding='utf-8') as f:
            json.dump(self.audio_index, f, ensure_ascii=False, indent=2)

    def get_file_hash(self, file_path):
        """计算文件的MD5哈希值"""
        hash_md5 = hashlib.md5()
        with open(file_path, "rb") as f:
            for chunk in iter(lambda: f.read(4096), b""):
                hash_md5.update(chunk)
        return hash_md5.hexdigest()

    def load_config(self):
        """加载配置文件"""
        if self.config_file.exists():
            try:
                with open(self.config_file, 'r', encoding='utf-8') as f:
                    config = json.load(f)
                    self.gemini_api_key = config.get('gemini_api_key', '')
                    self.silicon_cloud_api_key = config.get('silicon_cloud_api_key', '')
                    # 更新translationGemini.py中的api_key
                    import translationGemini
                    translationGemini.api_key = self.gemini_api_key
            except Exception as e:
                print(f"加载配置文件出错: {e}")
        else:
            self.save_config()

    def save_config(self):
        """保存配置文件"""
        try:
            config = {
                'gemini_api_key': self.gemini_api_key,
                'silicon_cloud_api_key': self.silicon_cloud_api_key
            }
            with open(self.config_file, 'w', encoding='utf-8') as f:
                json.dump(config, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"保存配置文件出错: {e}")

    def init_ui(self):
        """初始化UI"""
        # 主布局
        main_layout = QVBoxLayout()
        main_layout.setContentsMargins(24, 24, 24, 24)
        main_layout.setSpacing(20)

        # 顶部控制区域
        top_controls = QHBoxLayout()
        top_controls.setSpacing(16)
        
        # 选择音频按钮
        self.select_audio_btn = ModernMacButton('选择音频', accent=True)
        self.select_audio_btn.clicked.connect(self.load_audio)
        
        # 文件名显示区域 - 使用ScrollingLabel替代QScrollArea
        self.audio_file_label = ScrollingLabel('未选择音频文件')
        self.audio_file_label.setFixedHeight(32)
        self.audio_file_label.setStyleSheet("""
            QLabel {
                background-color: #F5F5F7;
                border-radius: 6px;
                color: #666666;
                padding: 0 12px;
                font-family: ".AppleSystemUIFont";
            }
        """)
        
        top_controls.addWidget(self.select_audio_btn)
        top_controls.addWidget(self.audio_file_label, 1)

        # 播放控制区域
        playback_controls = QHBoxLayout()
        playback_controls.setSpacing(16)
        
        self.play_button = ModernMacButton()
        self.play_button.setIcon(self.style().standardIcon(QStyle.SP_MediaPlay))
        self.play_button.clicked.connect(self.play_pause)
        self.play_button.setEnabled(False)
        self.play_button.setFixedWidth(32)
        
        # 添加中文字幕开关
        self.translation_toggle = ModernMacToggleButton("显示中文")
        self.translation_toggle.setChecked(True)
        self.translation_toggle.clicked.connect(self.toggle_translation)
        
        self.position_slider = ModernMacSlider(Qt.Horizontal)
        self.position_slider.sliderMoved.connect(self.set_position)
        self.position_slider.sliderPressed.connect(self.slider_pressed)
        self.position_slider.sliderReleased.connect(self.slider_released)
        
        self.time_label = QLabel('00:00 / 00:00')
        self.time_label.setStyleSheet("color: #666666;")
        
        playback_controls.addWidget(self.play_button)
        playback_controls.addWidget(self.position_slider)
        playback_controls.addWidget(self.time_label)
        playback_controls.addWidget(self.translation_toggle)

        # 翻译控制区域
        translation_controls = QHBoxLayout()
        translation_controls.setSpacing(16)
        
        self.google_radio = ModernMacButton('Google翻译', checkable=True)
        self.gemini_radio = ModernMacButton('Gemini翻译', checkable=True)
        self.silicon_cloud_radio = ModernMacButton('SiliconCloud翻译', checkable=True)
        self.google_radio.setChecked(True)  # 默认选中Google翻译
        
        button_group = QButtonGroup(self)
        button_group.addButton(self.google_radio)
        button_group.addButton(self.gemini_radio)
        button_group.addButton(self.silicon_cloud_radio)
        button_group.buttonClicked.connect(self.on_translation_option_changed)
        
        # API Key输入区域
        self.api_key_widget = QWidget()
        api_key_layout = QHBoxLayout(self.api_key_widget)
        api_key_layout.setContentsMargins(0, 0, 0, 0)
        api_key_layout.setSpacing(8)
        
        api_key_label = QLabel('API Key:')
        api_key_label.setStyleSheet("""
            QLabel {
                color: #1D1D1F;
                font-size: 14px;
                font-family: ".AppleSystemUIFont";
            }
        """)
        
        # 使用ModernMacLineEdit
        self.api_key_input = ModernMacLineEdit()
        self.api_key_input.setPlaceholderText("Google翻译无需API Key")
        self.api_key_input.setEnabled(False)  # Google翻译默认禁用API Key输入
        self.api_key_input.setEchoMode(QLineEdit.Password)
        self.api_key_input.textChanged.connect(self.on_api_key_changed)
        self.api_key_input.installEventFilter(self)
        
        api_key_layout.addWidget(api_key_label)
        api_key_layout.addWidget(self.api_key_input, 1)  # 让输入框占据剩余空间

        translation_controls.addWidget(self.google_radio)
        translation_controls.addWidget(self.gemini_radio)
        translation_controls.addWidget(self.silicon_cloud_radio)
        translation_controls.addWidget(self.api_key_widget)
        translation_controls.addStretch()

        # 内容区域
        content_area = QVBoxLayout()  # 改用垂直布局
        content_area.setSpacing(8)    # 减小间距
        
        # 字幕和历史文件的水平布局
        subtitle_history_layout = QHBoxLayout()
        subtitle_history_layout.setSpacing(20)
        
        # 字幕显示区域
        subtitle_container = QVBoxLayout()
        subtitle_container.setSpacing(8)
        
        subtitle_label = QLabel('字幕')
        subtitle_label.setStyleSheet('font-weight: 600;')
        
        self.subtitle_display = ModernMacTextBrowser()
        
        subtitle_container.addWidget(subtitle_label)
        subtitle_container.addWidget(self.subtitle_display)
        
        # 历史文件列表
        history_container = QVBoxLayout()
        history_container.setSpacing(8)
        
        history_label = QLabel('历史文件')
        history_label.setStyleSheet('font-weight: 600;')
        
        self.file_list = ModernMacTextBrowser()
        self.file_list.setMaximumWidth(240)
        self.file_list.anchorClicked.connect(self.load_cached_audio)
        
        history_container.addWidget(history_label)
        history_container.addWidget(self.file_list)
        
        # 添加到水平布局
        subtitle_history_layout.addLayout(subtitle_container, 7)
        subtitle_history_layout.addLayout(history_container, 3)
        
        # 将水平布局和进度条添加到内容区域
        content_area.addLayout(subtitle_history_layout)
        content_area.addWidget(self.progress_bar)
        
        # 添加所有组件到主布局
        main_layout.addLayout(top_controls)
        main_layout.addLayout(playback_controls)
        main_layout.addLayout(translation_controls)
        main_layout.addLayout(content_area)
        
        # 设置主布局
        self.setLayout(main_layout)
        
        # 初始化状态变量
        self.was_playing = False
        self.is_seeking = False
        
        # 初始化更新线程
        self.update_thread = SubtitleUpdateThread(self)
        self.update_thread.update_signal.connect(self.update_subtitle_efficient)
        
        # 确保媒体播放器连接了位置变化信号
        self.media_player.positionChanged.connect(self.position_changed)
        self.media_player.durationChanged.connect(self.duration_changed)
        
        # 显示历史文件列表
        self.display_cached_files()
        
        # 添加滚动条显示控制
        # self.subtitle_display.viewport().installEventFilter(self)
        # self.file_list.viewport().installEventFilter(self)

    def display_cached_files(self):
        """显示已缓存的频文件列表"""
        self.file_list.clear()
        html_content = []
        for file_hash, info in self.audio_index.items():
            file_name = Path(info['file_path']).name
            html_content.append(f'<p><a href="{file_hash}">{file_name}</a></p>')
        self.file_list.setHtml('\n'.join(html_content))

    def load_cached_audio(self, url):
        """加载已缓存的音频文件"""
        try:
            file_hash = url.toString()
            if file_hash in self.audio_index:
                audio_info = self.audio_index[file_hash]
                self.audio_file = audio_info['file_path']
                self.current_file_hash = file_hash
                subtitle_file = Path(audio_info['subtitle_file'])
                
                # 更新文件名显示 - 只显示文件名
                self.audio_file_label.setText(os.path.basename(self.audio_file))
                # 重置滚动位置
                self.audio_file_label.scroll_pos = 0
                self.audio_file_label.update()
                
                if subtitle_file.exists():
                    # 重置状态
                    if self.update_thread and self.update_thread.isRunning():
                        self.update_thread.stop()
                        self.update_thread.wait()
                    
                    # 加载字幕和翻译数据
                    self.load_cached_subtitles(subtitle_file)
                    self.setup_audio_playback()
                    
                    # 根据缓存的翻译器类型设置翻译按钮状态
                    if self.translations:
                        first_translation = next(iter(self.translations.values()))
                        translator_type = first_translation.get('translator', 'google')
                        self.update_translator_button_state(translator_type)
                        # 设置对应的API Key
                        self.set_api_key_for_translator(translator_type)
                    
                    # 重新初始化更新线程
                    self.update_thread = SubtitleUpdateThread(self)
                    self.update_thread.update_signal.connect(self.update_subtitle_efficient)
                    
                    # 重新显示文件列表
                    self.display_cached_files()
                    
                    # 确保滚动条重置到顶部
                    QTimer.singleShot(100, lambda: self.subtitle_display.verticalScrollBar().setValue(0))
                else:
                    QMessageBox.warning(self, "错误", "字幕文件不存在")
        except Exception as e:
            logging.error(f"加载缓存音频时出错: {e}")
            QMessageBox.warning(self, "错误", f"加载文件时出错: {e}")

    def load_audio(self):
        """选择并加载音频文件"""
        audio_file, _ = QFileDialog.getOpenFileName(self, "选择音频文件", "", "音频文件 (*.wav *.mp3)")
        if audio_file:
            # 禁用显示中文按钮
            self.translation_toggle.setEnabled(False)
            # 重置翻译器类型标记
            self._translation_type_set = False
            
            # 重置状态
            self.translations = {}
            self.subtitles = []
            self.subtitle_times = []
            self.word_positions = []
            self.current_subtitle_index = -1
            self.current_word_index = -1
            
            self.audio_file = audio_file
            # 更新文件名显示 - 只显示文件名
            self.audio_file_label.setText(os.path.basename(audio_file))
            
            file_hash = self.get_file_hash(audio_file)
            
            # 检查是否已有缓存的字幕数据
            if file_hash in self.audio_index:
                subtitle_file = self.subtitle_cache_dir / f"{file_hash}.json"
                if subtitle_file.exists():
                    self.load_cached_subtitles(subtitle_file)
                    self.setup_audio_playback()
                    # 启用显示中文按钮
                    self.translation_toggle.setEnabled(True)
                    return

            # 如果没有缓存，继续原有的转录流程
            url = QUrl.fromLocalFile(audio_file)
            content = QMediaContent(url)
            self.media_player.setMedia(content)
            self.play_button.setEnabled(False)

            self.subtitle_display.clear()
            self.subtitle_display.setHtml('<p style="font-size:16px; color:gray;">正在转录音频，请稍候...</p>')

            self.current_file_hash = file_hash
            self.thread = TranscriptionThread(self.audio_file, self.api_key)
            self.thread.transcription_done.connect(self.on_transcription_done)
            self.thread.error_occurred.connect(self.on_transcription_error)
            self.thread.start()

    def setup_audio_playback(self):
        """设置音频播放"""
        try:
            url = QUrl.fromLocalFile(self.audio_file)
            content = QMediaContent(url)
            self.media_player.setMedia(content)
            self.play_button.setEnabled(True)
            
            # 重置状态
            self.last_subtitle_index = -1
            self.last_word_index = -1
            self.last_update_time = 0
            
            # 确保更新线程正确初始化
            if self.update_thread is None:
                self.update_thread = SubtitleUpdateThread(self)
                self.update_thread.update_signal.connect(self.update_subtitle_efficient)
            else:
                if not self.update_thread.isRunning():
                    self.update_thread.start()
        except Exception as e:
            print(f"设置音频播放时出错: {e}")

    def load_cached_subtitles(self, subtitle_file):
        """加载缓存的字幕数据，包括翻译结果"""
        with open(subtitle_file, 'r', encoding='utf-8') as f:
            cached_data = json.load(f)
        
        self.subtitles = cached_data['subtitles']
        self.translations = cached_data.get('translations', {})
        
        # 根据保存的翻译器类型设置选中状态
        if self.translations:
            first_translation = next(iter(self.translations.values()))
            translator_type = first_translation.get('translator', 'google')
            if translator_type == 'google':
                self.google_radio.setChecked(True)
            else:
                self.gemini_radio.setChecked(True)
        
        self.subtitle_times = [sub['start_time'] for sub in self.subtitles]
        self.word_start_times = []
        
        # 重建词级别的时间信息
        for subtitle in self.subtitles:
            for word in subtitle['words']:
                self.word_start_times.append(word['start'])

        self.current_subtitle_index = -1
        self.current_word_index = -1
        
        self.display_subtitles()

    def on_transcription_done(self, transcript):
        """处理转录完成"""
        try:
            # 解析转录结果
            self.parse_transcript(transcript)
            
            # 保存到缓存
            self.save_subtitle_cache()
            
            # 更新音频索引
            self.audio_index[self.current_file_hash] = {
                'file_path': self.audio_file,
                'subtitle_file': str(self.subtitle_cache_dir / f"{self.current_file_hash}.json")
            }
            self.save_audio_index()
            self.display_cached_files()
            
            # 设置播放器状态
            self.play_button.setEnabled(True)
            
            # 确保字幕位置信息已正确初始化
            self.initialize_subtitle_positions()
            
            # 重新初始化更新线程
            self.initialize_update_thread()
            
            # 强制更新一次当前位置的字幕
            current_position = self.media_player.position()
            self.update_subtitle_efficient(current_position)
            if self.update_thread:
                self.update_thread.force_update()
            
            # 启用显示中文按钮
            self.translation_toggle.setEnabled(True)
            
        except Exception as e:
            logging.error(f"处理转录完成时出错: {e}")
            self.subtitle_display.setHtml(
                '<p style="color:red;">处理转录结果时出错，请重试。</p>'
            )
            self.translation_toggle.setEnabled(True)

    def initialize_subtitle_positions(self):
        """初始化字幕位置信息"""
        try:
            self.subtitle_positions = []
            self.word_positions = []
            
            cursor = self.subtitle_display.textCursor()
            cursor.movePosition(QTextCursor.Start)
            
            for idx, subtitle in enumerate(self.subtitles):
                block_start = cursor.position()
                self.subtitle_positions.append(block_start)
                
                # 跳过说话者标识 "A: " 或 "B: "
                cursor.movePosition(QTextCursor.Right, QTextCursor.MoveAnchor, 3)
                
                # 记录每个单词的位置
                for word in subtitle['words']:
                    word_start = cursor.position()
                    cursor.movePosition(QTextCursor.Right, QTextCursor.MoveAnchor, 
                                     len(word['text']))
                    # 记录单词位置信息
                    self.word_positions.append({
                        'start_pos': word_start,
                        'end_pos': cursor.position(),
                        'start_time': word['start'],
                        'end_time': word['end']
                    })
                    # 移动到下一个单词（跳过空格）
                    cursor.movePosition(QTextCursor.Right)
                
                # 移动到下一个字幕块
                cursor.movePosition(QTextCursor.NextBlock)
                if self.show_translation and idx < len(self.subtitles) - 1:
                    cursor.movePosition(QTextCursor.NextBlock)  # 跳过翻译行
                
            # 重置索引
            self.last_subtitle_index = -1
            self.last_word_index = -1
            
        except Exception as e:
            print(f"初始化字幕位置信息时出错: {e}")

    def start_translation(self):
        """开始翻译处理"""
        try:
            # 过滤有效的字幕文本
            texts_to_translate = []
            for idx, subtitle in enumerate(self.subtitles):
                text = subtitle.get('text', '').strip()
                if text:  # 确保文本不为空
                    texts_to_translate.append((idx, text))
            
            if not texts_to_translate:
                logging.warning("没有找到可翻译的字幕")
                QMessageBox.warning(self, "警告", "没有找到可翻译的字幕文本")
                return

            # 初始化进度
            self.total_translation_count = len(texts_to_translate)
            self.current_translation_count = 0
            self.translation_progress.clear()
            
            # 设置翻译器类型和API key
            translator_type = 'google'
            api_key = None
            
            if self.silicon_cloud_radio.isChecked():
                translator_type = 'silicon_cloud'
                api_key = self.silicon_cloud_api_key
                if not api_key:
                    logging.warning("未设置SiliconCloud API Key")
                    QMessageBox.warning(self, "警告", "请先设置SiliconCloud API Key")
                    return
            elif self.gemini_radio.isChecked():
                translator_type = 'gemini'
                api_key = self.gemini_api_key
                if not api_key:
                    logging.warning("未设置Gemini API Key")
                    QMessageBox.warning(self, "警告", "请先设置Gemini API Key")
                    return

            logging.info(f"开始批量翻译任务 - 使用{translator_type}翻译器，共{self.total_translation_count}条")
            
            # 显示进度条
            self.progress_bar.setVisible(True)
            self.progress_bar.set_progress(0, self.total_translation_count, "准备翻译...")

            # 创建并启动翻译线程
            self.translation_threads = []
            for idx, text in texts_to_translate:
                thread = TranslationThread(idx, text, translator_type, api_key, self.translation_semaphore)
                thread.translation_done.connect(self.on_translation_done)
                self.translation_threads.append(thread)
                thread.start()
                logging.info(f"启动翻译线程 [ID:{idx}] - 文本: {text[:50]}...")

        except Exception as e:
            logging.error(f"启动翻译任务失败: {e}")
            QMessageBox.critical(self, "错误", f"启动翻译任务失败: {e}")

    def on_translation_done(self, index, translation, translator_type):
        """处理单个翻译完成"""
        try:
            if not hasattr(self, 'total_translation_count') or self.total_translation_count <= 0:
                logging.error("翻译总数未正确初始化")
                return

            # 保存翻译结果
            self.translations[str(index)] = {
                'text': translation,
                'translator': translator_type
            }
            
            # 更新进度
            self.current_translation_count += 1
            progress = int((self.current_translation_count / self.total_translation_count) * 100)
            
            # 更新进度条
            self.progress_bar.set_progress(
                self.current_translation_count,
                self.total_translation_count,
                f"翻译进度: {progress}%"
            )
            
            logging.info(f"翻译进度: {self.current_translation_count}/{self.total_translation_count}")

            # 检查是否所有翻译都完成
            if self.current_translation_count >= self.total_translation_count:
                logging.info("所有翻译任务完成")
                self.progress_bar.setVisible(False)
                self.save_translation_cache()  # 保存翻译结果到缓存
                self.save_subtitle_cache()  # 保存字幕和翻译结果到本地文件
                self.display_subtitles()

        except Exception as e:
            logging.error(f"处理翻译结果时出错 [ID:{index}]: {str(e)}")

    def initialize_update_thread(self):
        """初始化更新线程"""
        if self.update_thread is None:
            self.update_thread = SubtitleUpdateThread(self)
            self.update_thread.update_signal.connect(self.update_subtitle_efficient)
            self.update_thread.start()

    def on_transcription_error(self, error_message):
        self.subtitle_display.clear()
        self.subtitle_display.setHtml(f'<p style="font-size:16px; color:red;">获取转录结果时出错：{error_message}</p>')
        QMessageBox.critical(self, "错误", f"获取转录结果时出错：{error_message}")
        self.play_button.setEnabled(False)

    def parse_transcript(self, transcript):
        """解析转录结果"""
        try:
            self.subtitles = []
            self.subtitle_times = []
            self.word_positions = []
            self.current_subtitle_index = -1
            self.word_start_times = []
            self.current_display_index = 0  # 重置显示索引

            for utterance in transcript.utterances:
                words = []
                for word in utterance.words:
                    words.append({
                        'text': word.text,
                        'start': word.start,
                        'end': word.end
                    })
                
                # 添加text字段到字幕数据中
                self.subtitles.append({
                    'speaker': utterance.speaker,
                    'start_time': utterance.start,
                    'end_time': utterance.end,
                    'text': utterance.text,  # 确保添加text字段
                    'words': words
                })
                self.subtitle_times.append(utterance.start)

                for word in words:
                    self.word_start_times.append(word['start'])
            
            # 开始逐条显示字幕
            self.start_progressive_display()
            
            # 在解析完成后立即开始翻译
            if self.subtitles:
                self.start_translation()
            else:
                logging.warning("转录结果为空，无法开始翻译")
                
        except Exception as e:
            logging.error(f"解析转录结果时出错: {e}")
            raise

    def start_progressive_display(self):
        """开始逐条显示字幕"""
        self.subtitle_display.clear()
        self.current_display_index = 0
        self.subtitle_positions = []
        self.word_positions = []
        self.subtitle_blocks = []
        self.progress_bar.show()
        self.progress_bar.set_progress(0, len(self.subtitles), "正显示字幕...")
        self.display_timer.start(self.display_interval)

    def display_next_subtitle(self):
        """显示下一条字幕，确保按顺序显示并保持对应关系"""
        try:
            if self.current_display_index >= len(self.subtitles):
                self.display_timer.stop()
                return

            cursor = self.subtitle_display.textCursor()
            current_scroll = self.subtitle_display.verticalScrollBar().value()
            
            # 移动到末尾
            cursor.movePosition(QTextCursor.End)
            block_start = cursor.position()
            
            # 获取当前字幕
            subtitle = self.subtitles[self.current_display_index]
            str_index = str(self.current_display_index)
            
            # 创建字幕块容器
            subtitle_block = {
                'index': self.current_display_index,
                'start': block_start,
                'content_start': 0,
                'translation_start': 0,
                'translation_end': 0,
                'end': 0,
                'speaker': subtitle['speaker']
            }
            
            # 1. 显示原文部分
            color = '#2196F3' if subtitle['speaker'] == 'A' else '#4CAF50'
            speaker_fmt = QTextCharFormat()
            speaker_fmt.setForeground(QColor(color))
            
            # 显示说话者标识
            cursor.insertText(f"{subtitle['speaker']}: ", speaker_fmt)
            
            # 显示原文内容
            subtitle_block['content_start'] = cursor.position()
            content_fmt = QTextCharFormat()
            content_fmt.setForeground(QColor(color))
            
            # 记录每个单词的位置
            word_positions = []
            for word in subtitle['words']:
                word_start_pos = cursor.position()
                cursor.insertText(word['text'] + ' ', content_fmt)
                word_end_pos = cursor.position()
                word_positions.append({
                    'start_pos': word_start_pos,
                    'end_pos': word_end_pos,
                    'start_time': word['start'],
                    'end_time': word['end']
                })
            
            cursor.insertBlock()
            
            # 2. 显示翻译部分
            subtitle_block['translation_start'] = cursor.position()
            translation_text = ""
            if str_index in self.translations:
                translation_text = self.translations[str_index]['text']
            
            trans_fmt = QTextCharFormat()
            trans_fmt.setForeground(QColor('#000000'))
            cursor.insertText(translation_text, trans_fmt)
            subtitle_block['translation_end'] = cursor.position()
            
            # 添加额外的换行
            if self.current_display_index < len(self.subtitles) - 1:
                cursor.insertBlock()
            
            # 更新块结束位置
            subtitle_block['end'] = cursor.position()
            
            # 保存字幕块信息
            self.subtitle_blocks.append(subtitle_block)
            
            # 保存单词位置信息
            self.word_positions.extend(word_positions)
            
            # 更新进度条
            total_subtitles = len(self.subtitles)
            progress = ((self.current_display_index + 1) / total_subtitles) * 100
            self.progress_bar.set_progress(
                self.current_display_index + 1,
                total_subtitles,
                f"正在显示字幕... ({self.current_display_index + 1}/{total_subtitles}, {progress:.1f}%)"
            )
            
            # 更新显示索引
            self.current_display_index += 1
            
            # 恢复滚动位置
            self.subtitle_display.verticalScrollBar().setValue(current_scroll)
            
        except Exception as e:
            print(f"显示下一条字幕时出错: {e}")

    def save_subtitle_cache(self):
        """保存字幕和翻译缓存，确保按顺序保存"""
        try:
            # 按索引排序翻译结果
            sorted_translations = {}
            for idx in range(len(self.subtitles)):
                str_idx = str(idx)
                if str_idx in self.translations:
                    sorted_translations[str_idx] = self.translations[str_idx]
            
            cache_data = {
                'subtitles': self.subtitles,
                'translations': sorted_translations,
                'file_path': self.audio_file
            }
            
            subtitle_file = self.subtitle_cache_dir / f"{self.current_file_hash}.json"
            with open(subtitle_file, 'w', encoding='utf-8') as f:
                json.dump(cache_data, f, ensure_ascii=False, indent=2)
            
        except Exception as e:
            print(f"保存字幕缓存时出错: {e}")

    def display_subtitles(self):
        """显示双语字幕"""
        try:
            self.subtitle_display.clear()
            self.subtitle_blocks = []
            cursor = self.subtitle_display.textCursor()
            
            # 如果没有字幕数据，禁用显示中文按钮并返回
            if not self.subtitles:
                self.translation_toggle.setEnabled(False)
                self.subtitle_display.setHtml('<p style="font-size:16px; color:gray;">暂无字幕信息</p>')
                return
            
            # 提前确定翻译器类型，只需检查一次
            translator_type = None
            if self.translations:
                first_translation = next(iter(self.translations.values()))
                translator_type = first_translation.get('translator', 'google')
                # 仅在首次加载字幕时更新翻译器按钮状态，而不是每次切换显示中文时都更新
                if not hasattr(self, '_translation_type_set'):
                    self.update_translator_button_state(translator_type)
                    self._translation_type_set = True
            
            # 启用显示中文按钮
            self.translation_toggle.setEnabled(True)
            
            for idx, subtitle in enumerate(self.subtitles):
                # 记录字幕块起始位置
                block_start = cursor.position()
                
                # 创建字幕块容器
                subtitle_block = {
                    'index': idx,
                    'start': block_start,
                    'content_start': 0,
                    'translation_start': 0,
                    'translation_end': 0,
                    'end': 0,
                    'speaker': subtitle['speaker']
                }
                
                # 显示说话者标识和原文内容
                color = '#2196F3' if subtitle['speaker'] == 'A' else '#4CAF50'
                speaker_fmt = QTextCharFormat()
                speaker_fmt.setForeground(QColor(color))
                cursor.insertText(f"{subtitle['speaker']}: ", speaker_fmt)
                
                # 记录内容起始位置
                subtitle_block['content_start'] = cursor.position()
                
                # 显示原文内容
                content_fmt = QTextCharFormat()
                content_fmt.setForeground(QColor(color))
                
                # 记录单词位置
                for word in subtitle['words']:
                    word_start_pos = cursor.position()
                    cursor.insertText(word['text'], content_fmt)  # 先插入单词
                    word_end_pos = cursor.position()
                    cursor.insertText(' ', content_fmt)  # 再插入空格
                    
                    self.word_positions.append({
                        'start_pos': word_start_pos,
                        'end_pos': word_end_pos,
                        'start_time': word['start'],
                        'end_time': word['end']
                    })
                
                cursor.insertBlock()
                
                # 记录翻译起始位置
                subtitle_block['translation_start'] = cursor.position()
                
                # 根据显示设置显示翻译
                if self.show_translation:
                    trans_fmt = QTextCharFormat()
                    trans_fmt.setForeground(QColor('#000000'))
                    
                    translation_text = ""
                    if str(idx) in self.translations:
                        translation_text = self.translations[str(idx)]['text']
                    elif str(idx) in self.pending_translations:
                        translation_text = self.pending_translations[str(idx)]
                    
                    cursor.insertText(translation_text, trans_fmt)
                    cursor.insertBlock()
                
                # 记录翻译结束位置
                subtitle_block['translation_end'] = cursor.position()
                subtitle_block['end'] = cursor.position()
                
                # 保存字幕块信息
                self.subtitle_blocks.append(subtitle_block)
                self.subtitle_positions.append(block_start)
            
            # 恢复滚动位置
            self.subtitle_display.restore_scroll_position()
            
            # 重新初始化字幕位置信息
            self.initialize_subtitle_positions()
            
        except Exception as e:
            print(f"显示字幕时出错: {e}")

    def update_translator_button_state(self, translator_type):
        """更新翻译按钮状态"""
        try:
            # 阻止按钮状态改变时触发的事件
            self.block_translation_signals = True
            
            # 根据翻译类型选中对应按钮
            if translator_type == 'silicon_cloud':
                self.silicon_cloud_radio.setChecked(True)
                self.api_key_input.setEnabled(True)
                self.api_key_input.setPlaceholderText("输入SiliconCloud API Key")
            elif translator_type == 'gemini':
                self.gemini_radio.setChecked(True)
                self.api_key_input.setEnabled(True)
                self.api_key_input.setPlaceholderText("输入Gemini API Key")
            else:  # 默认使用Google翻译
                self.google_radio.setChecked(True)
                self.api_key_input.setEnabled(False)
                self.api_key_input.setPlaceholderText("Google翻译无需API Key")
            
            # 恢复按钮信号
            self.block_translation_signals = False
            
            logging.info(f"更新翻译按钮状态: {translator_type}")
        except Exception as e:
            logging.error(f"更新翻译按钮状态时出错: {e}")

    def set_api_key_for_translator(self, translator_type):
        """设置对应翻译器的API Key"""
        try:
            if translator_type == 'silicon_cloud':
                self.api_key_input.setText(self.silicon_cloud_api_key)
            elif translator_type == 'gemini':
                self.api_key_input.setText(self.gemini_api_key)
            else:  # google
                self.api_key_input.clear()
        except Exception as e:
            logging.error(f"设置API Key时出错: {e}")

    def update_translation(self, index, translation):
        """更新单个翻译结果"""
        try:
            # 找到对应字幕块
            block = next((b for b in self.subtitle_blocks if b['index'] == index), None)
            if not block:
                self.pending_translations[str(index)] = translation
                return
            
            # 保存当前滚动位置
            current_scroll = self.subtitle_display.verticalScrollBar().value()
            
            cursor = self.subtitle_display.textCursor()
            
            # 确保位置有效
            if block['translation_start'] >= 0 and block['translation_end'] >= block['translation_start']:
                # 计算原翻译的长度
                old_length = block['translation_end'] - block['translation_start']
                
                # 移动到翻译位置并选择整个翻译区域
                cursor.setPosition(block['translation_start'])
                cursor.setPosition(block['translation_end'], QTextCursor.KeepAnchor)
                
                # 确保新插入的翻译文本使用黑色
                fmt = QTextCharFormat()
                fmt.setForeground(QColor('#000000'))
                cursor.mergeCharFormat(fmt)
                cursor.insertText(translation)
                
                # 计算新翻译的长度差
                new_length = len(translation)
                length_diff = new_length - old_length
                
                # 更新当前块的结束位置
                block['translation_end'] = block['translation_start'] + new_length
                block['end'] = block['translation_end']
                
                # 更新后续块的位置
                for later_block in self.subtitle_blocks:
                    if later_block['index'] > index:
                        later_block['start'] += length_diff
                        later_block['content_start'] += length_diff
                        later_block['translation_start'] += length_diff
                        later_block['translation_end'] += length_diff
                        later_block['end'] += length_diff
                
                # 更新字幕位置数组
                for i in range(index + 1, len(self.subtitle_positions)):
                    self.subtitle_positions[i] += length_diff
                
                # 更新单词位置信息
                for word_pos in self.word_positions:
                    if word_pos['start_pos'] > block['translation_start']:
                        word_pos['start_pos'] += length_diff
                        word_pos['end_pos'] += length_diff
            
            # 恢复滚动位置
            self.subtitle_display.verticalScrollBar().setValue(current_scroll)
            
        except Exception as e:
            print(f"更新翻译时出错: {e}")
            self.pending_translations[str(index)] = translation

    def play_pause(self):
        """处理播放/暂停按钮点击事件"""
        try:
            if not self.media_player.media().isNull():
                if self.media_player.state() == QMediaPlayer.PlayingState:
                    self.media_player.pause()
                    self.play_button.setIcon(self.style().standardIcon(QStyle.SP_MediaPlay))
                    if self.update_thread:
                        self.update_thread.pause()
                else:
                    self.media_player.play()
                    self.play_button.setIcon(self.style().standardIcon(QStyle.SP_MediaPause))
                    
                    # 确保更新线程在运行
                    if self.update_thread is None:
                        self.initialize_update_thread()
                    else:
                        self.update_thread.resume()
                        if not self.update_thread.isRunning():
                            self.update_thread.start()
                    
                    # 强制更新一次当前位置的字幕
                    current_position = self.media_player.position()
                    self.update_subtitle_efficient(current_position)
                    if self.update_thread:
                        self.update_thread.force_update()
        except Exception as e:
            print(f"播放控制出错: {e}")

    def position_changed(self, position):
        """处理播放位置变化"""
        try:
            self.position_slider.setValue(position)
            self.update_time_label(position)
            
            # 确保更新线在运行
            if (self.media_player.state() == QMediaPlayer.PlayingState and 
                self.update_thread and not self.update_thread.isRunning()):
                self.update_thread.resume()
                self.update_thread.start()
            
        except Exception as e:
            print(f"处理位置变化时出错: {e}")

    def duration_changed(self, duration):
        self.position_slider.setRange(0, duration)
        self.total_duration = duration
        self.update_time_label(self.media_player.position())

    def set_position(self, position):
        """处理进度条拖动事件"""
        try:
            self.media_player.setPosition(position)
            
            # 重置状态
            self.clear_all_highlights()
            self.last_subtitle_index = -1
            self.last_word_index = -1
            
            # 强制更新字幕位置
            self.update_subtitle_efficient(position)
            
            # 确保字幕显示区域滚动到正确位置
            self.scroll_to_current_subtitle(position)
            
            # 强制触发一次更新
            if self.update_thread:
                self.update_thread.force_update()
                
        except Exception as e:
            print(f"设置位置时出错: {e}")

    def scroll_to_current_subtitle(self, position):
        """改进的滚动到当前字幕位置方法"""
        try:
            # 找到当前时间对应的字幕索引
            subtitle_idx = bisect.bisect_right(self.subtitle_times, position) - 1
            if 0 <= subtitle_idx < len(self.subtitle_blocks):
                block = self.subtitle_blocks[subtitle_idx]
                
                # 计算目标滚动位置
                cursor = self.subtitle_display.textCursor()
                cursor.setPosition(block['start'])
                
                # 获取字幕块的矩形区域
                block_rect = self.subtitle_display.document().documentLayout().blockBoundingRect(cursor.block())
                
                # 计算字幕块的中心位
                block_center = block_rect.center().y()
                
                # 计算视口中心位置
                viewport_height = self.subtitle_display.viewport().height()
                viewport_center = viewport_height / 2
                
                # 计算需要滚动的位置
                target_scroll = block_center - viewport_center
                
                # 使用平滑滚动
                self.subtitle_display.smooth_scroll_to_position(int(target_scroll))
                
        except Exception as e:
            print(f"滚动到当前字幕位置时出错: {e}")

    def update_time_label(self, position):
        current_time_str = self.format_time(position)
        total_time_str = self.format_time(self.total_duration)
        self.time_label.setText(f'{current_time_str} / {total_time_str}')

    def format_time(self, ms):
        s = ms // 1000
        h = s // 3600
        m = (s % 3600) // 60
        s = s % 60
        if h > 0:
            return f'{h:02}:{m:02}:{s:02}'
        else:
            return f'{m:02}:{s:02}'

    def update_subtitle_efficient(self, current_time):
        """改进的字幕更新方法"""
        try:
            # 检查数据是否有效
            if not self.subtitle_positions or not self.word_positions:
                return
            
            # 对于拖动操作，忽略更间隔检查
            is_seeking = abs(current_time - self.last_update_time) > 1000
            if not is_seeking and current_time - self.last_update_time < self.update_interval:
                return
            
            self.last_update_time = current_time
            
            # 更新字幕
            subtitle_idx = bisect.bisect_right(self.subtitle_times, current_time) - 1
            
            # 确保字幕索引在有效围
            if subtitle_idx >= len(self.subtitle_blocks):
                subtitle_idx = len(self.subtitle_blocks) - 1
            
            # 更新字幕高亮
            if subtitle_idx != self.last_subtitle_index:
                # 清除旧的字幕高亮
                if 0 <= self.last_subtitle_index < len(self.subtitle_blocks):
                    self.highlight_subtitle(self.last_subtitle_index, False)
                
                # 设置新的字幕高亮
                if 0 <= subtitle_idx < len(self.subtitle_blocks):
                    self.highlight_subtitle(subtitle_idx, True)
                    # 滚动到当前字幕
                    self.scroll_to_current_subtitle(current_time)
                
                self.last_subtitle_index = subtitle_idx
            
            # 更新单词高亮
            word_idx = bisect.bisect_right(self.word_start_times, current_time) - 1
            
            # 确保单词索引在有效范围内
            if word_idx >= len(self.word_positions):
                word_idx = len(self.word_positions) - 1
            
            # 如果单词索引发生变化，需要更新高亮
            if word_idx != self.last_word_index:
                # 清除旧的单词高亮
                if 0 <= self.last_word_index < len(self.word_positions):
                    self.highlight_word(self.last_word_index, False)
                
                # 设置新的单词高亮
                if 0 <= word_idx < len(self.word_positions):
                    self.highlight_word(word_idx, True)
                
                self.last_word_index = word_idx
            
        except Exception as e:
            print(f"更新字幕时出错: {e}")

    def clear_all_highlights(self):
        """清除所有高亮"""
        try:
            # 清除所有字幕高亮
            cursor = QTextCursor(self.subtitle_display.document())
            cursor.select(QTextCursor.Document)
            fmt = QTextCharFormat()
            fmt.setBackground(Qt.transparent)
            cursor.mergeCharFormat(fmt)
        except Exception as e:
            print(f"清除高亮时出错: {e}")

    def highlight_subtitle(self, idx, highlight):
        """优化的字幕高亮方法"""
        try:
            if not (0 <= idx < len(self.subtitle_blocks)):
                return
            
            block = self.subtitle_blocks[idx]
            cursor = QTextCursor(self.subtitle_display.document())
            
            # 使用字幕块的完整范围
            start_pos = block['start']
            end_pos = block['end']
            
            # 验证位置的有效性
            doc_length = self.subtitle_display.document().characterCount()
            start_pos = max(0, min(start_pos, doc_length - 1))
            end_pos = max(start_pos, min(end_pos, doc_length - 1))
            
            cursor.setPosition(start_pos)
            cursor.setPosition(end_pos, QTextCursor.KeepAnchor)
            
            fmt = QTextCharFormat()
            if highlight:
                fmt.setBackground(QColor('#FFFF99'))
            else:
                fmt.setBackground(Qt.transparent)
            
            cursor.mergeCharFormat(fmt)
            
            if highlight:
                # 确保高亮的文本可见
                cursor.setPosition(start_pos)
                self.subtitle_display.setTextCursor(cursor)
                self.subtitle_display.ensureCursorVisible()
            
        except Exception as e:
            print(f"高亮字幕时出错: {e}")

    def highlight_word(self, idx, highlight):
        """优化的单词高亮方法"""
        try:
            if 0 <= idx < len(self.word_positions):
                word_info = self.word_positions[idx]
                cursor = QTextCursor(self.subtitle_display.document())
                
                # 验证位置的有效性
                doc_length = self.subtitle_display.document().characterCount()
                start_pos = max(0, min(word_info['start_pos'], doc_length - 1))
                end_pos = max(start_pos, min(word_info['end_pos'], doc_length - 1))

                cursor.setPosition(start_pos)
                cursor.setPosition(end_pos, QTextCursor.KeepAnchor)

                fmt = QTextCharFormat()
                if highlight:
                    # 当前播放的单词使用橙色高亮
                    fmt.setBackground(QColor('#FFCC66'))
                else:
                    # 非高亮状态，检查是否在当前字幕段落内
                    if (self.last_subtitle_index >= 0 and 
                        0 <= self.last_subtitle_index < len(self.subtitle_positions) and
                        start_pos >= self.subtitle_positions[self.last_subtitle_index]):
                        # 如果在当前字幕段落内，使用浅黄色背景
                        fmt.setBackground(QColor('#FFFF99'))
                    else:
                        # 如果不在当前字幕段落内，完全清除高亮
                        fmt.setBackground(Qt.transparent)

                cursor.mergeCharFormat(fmt)
        except Exception as e:
            print(f"单词高亮更新错: {e}")

    def closeEvent(self, event):
        """处理窗口关闭事件"""
        try:
            # 停止媒体播放
            if hasattr(self, 'media_player'):
                self.media_player.stop()
            
            # 停止更新线程
            if hasattr(self, 'update_thread') and self.update_thread:
                self.update_thread.stop()
                self.update_thread.wait()
            
            # 停止翻译线程
            if hasattr(self, 'translation_thread') and self.translation_thread:
                self.translation_thread.stop()
                self.translation_thread.wait()
            
            # 停止音频文件标签的滚动计时器
            if hasattr(self, 'audio_file_label'):
                self.audio_file_label.scroll_timer.stop()
            
            event.accept()
        except Exception as e:
            print(f"关闭程序时出错: {e}")
            event.accept()

    def toggle_api_key_visibility(self):
        """切换API Key的显示/隐藏状态"""
        if self.api_key_input.echoMode() == QLineEdit.Password:
            self.api_key_input.setEchoMode(QLineEdit.Normal)
            self.toggle_visibility_btn.setIcon(self.style().standardIcon(QStyle.SP_DialogNoButton))
        else:
            self.api_key_input.setEchoMode(QLineEdit.Password)
            self.toggle_visibility_btn.setIcon(self.style().standardIcon(QStyle.SP_DialogYesButton))

    def on_translation_option_changed(self, button):
        """处理翻译选项改变事件"""
        # 清除当前的hover timer
        self.hover_timer.stop()
        
        # 更新API Key输入框的值和状态
        if button == self.gemini_radio:
            self.api_key_input.setText(self.gemini_api_key)
            self.api_key_input.setPlaceholderText("输入Gemini API Key")
            self.api_key_input.setEnabled(True)
        elif button == self.silicon_cloud_radio:
            self.api_key_input.setText(self.silicon_cloud_api_key)
            self.api_key_input.setPlaceholderText("输入SiliconCloud API Key")
            self.api_key_input.setEnabled(True)
        else:  # Google翻译
            self.api_key_input.clear()
            self.api_key_input.setPlaceholderText("Google翻译无需API Key")
            self.api_key_input.setEnabled(False)
            return
            
        self.api_key_input.setEchoMode(QLineEdit.Password)

    def on_api_key_changed(self, text):
        """处理API Key变化事件"""
        if self.gemini_radio.isChecked():
            self.gemini_api_key = text
            import translationGemini
            translationGemini.api_key = text
        elif self.silicon_cloud_radio.isChecked():
            self.silicon_cloud_api_key = text
        
        # 保存配置
        self.save_config()

    def eventFilter(self, obj, event):
        """事件过滤器，处理鼠标悬停事件"""
        if obj == self.api_key_input:
            if event.type() == QEvent.Enter:
                # 先断开之前的所有连接
                try:
                    self.hover_timer.timeout.disconnect()
                except TypeError:
                    pass  # 忽略断开连接失败的错误
                
                # 根据当前选中的翻译选项设置悬停提示
                if self.gemini_radio.isChecked():
                    self.hover_timer.timeout.connect(lambda: self.show_api_key("gemini"))
                elif self.silicon_cloud_radio.isChecked():
                    self.hover_timer.timeout.connect(lambda: self.show_api_key("silicon_cloud"))
                self.hover_timer.start(1000)  # 1秒后显示明文
                
            elif event.type() == QEvent.Leave:
                self.hover_timer.stop()
                self.api_key_input.setEchoMode(QLineEdit.Password)
                # 安全断开连接
                try:
                    self.hover_timer.timeout.disconnect()
                except TypeError:
                    pass  # 忽略断开连接失败的错误
                
        return super().eventFilter(obj, event)

    def show_api_key(self, key_type):
        """显示API Key明文"""
        try:
            if key_type == "gemini" and self.gemini_radio.isChecked():
                self.api_key_input.setText(self.gemini_api_key)
            elif key_type == "silicon_cloud" and self.silicon_cloud_radio.isChecked():
                self.api_key_input.setText(self.silicon_cloud_api_key)
            self.api_key_input.setEchoMode(QLineEdit.Normal)
        except Exception as e:
            print(f"显示API Key时出错: {e}")

    def start_filename_scroll(self, event):
        """开始自动滚动文件名"""
        if self.audio_file_label.text() != '未选择音频文件':
            # 计算是否需要滚动
            content_width = self.audio_file_label.sizeHint().width()
            visible_width = self.filename_scroll_area.width()
            if content_width > visible_width:
                self.scroll_timer.start(50)  # 50ms 的滚动间隔

    def stop_filename_scroll(self, event):
        """停止自动滚动文件名"""
        self.scroll_timer.stop()
        # 平滑地滚动回开始位置
        QTimer.singleShot(100, lambda: self.filename_scroll_area.horizontalScrollBar().setValue(0))

    def auto_scroll_filename(self):
        """执行文件名自动滚动"""
        scrollbar = self.filename_scroll_area.horizontalScrollBar()
        content_width = self.audio_file_label.sizeHint().width()
        visible_width = self.filename_scroll_area.width()
        max_scroll = content_width - visible_width
        
        if max_scroll <= 0:
            return
        
        # 更新滚动位置
        self.scroll_position += self.scroll_direction * 2
        
        # 检查是否需要改变方向
        if self.scroll_position >= max_scroll:
            self.scroll_position = max_scroll
            self.scroll_direction = -1
        elif self.scroll_position <= 0:
            self.scroll_position = 0
            self.scroll_direction = 1
        
        scrollbar.setValue(self.scroll_position)

    def update_filename_display(self, filename):
        """更新文件名显示"""
        display_name = os.path.basename(filename)
        self.audio_file_label.setText(display_name)
        # 确保标签大小更新
        self.audio_file_label.adjustSize()

    def toggle_translation(self):
        """切换中文字幕显示状态"""
        try:
            self.show_translation = self.translation_toggle.isChecked()
            
            # 保存当前播放状态和位置
            current_position = self.media_player.position()
            was_playing = self.media_player.state() == QMediaPlayer.PlayingState
            
            # 暂停更新线程
            if self.update_thread:
                self.update_thread.pause()
            
            # 清除所有高亮
            self.clear_all_highlights()
            
            # 重置状态
            self.last_subtitle_index = -1
            self.last_word_index = -1
            
            # 重新显示字幕 - 无需更新翻译器按钮状态
            self.display_subtitles()
            
            # 强制更新当前字幕高亮
            self.update_subtitle_efficient(current_position)
            
            # 恢复更新线程
            if self.update_thread:
                if was_playing:
                    self.update_thread.resume()
                self.update_thread.force_update()
            
            # 确保滚动到正确位置
            self.scroll_to_current_subtitle(current_position)
            
        except Exception as e:
            print(f"切换翻译显示时出错: {e}")

    def handle_media_error(self, error):
        """处理媒体播放错误"""
        error_messages = {
            QMediaPlayer.NoError: "无错误",
            QMediaPlayer.ResourceError: "媒体资源无法访问",
            QMediaPlayer.FormatError: "不支持的媒体格式",
            QMediaPlayer.NetworkError: "网络错误",
            QMediaPlayer.AccessDeniedError: "访问被拒绝",
            QMediaPlayer.ServiceMissingError: "未找到所需服务"
        }
        
        error_message = error_messages.get(error, "未知错误")
        QMessageBox.critical(self, "媒体播放错误", f"播放出错: {error_message}")
        
        # 重置播放按钮状态
        self.play_button.setIcon(self.style().standardIcon(QStyle.SP_MediaPlay))
        self.play_button.setEnabled(False)

    def slider_pressed(self):
        """处理滑块按下事件"""
        self.is_seeking = True
        # 保存当前播放状态
        self.was_playing = self.media_player.state() == QMediaPlayer.PlayingState
        if self.was_playing:
            self.media_player.pause()
            
    def slider_released(self):
        """处理滑块释放事件"""
        self.is_seeking = False
        # 如果之前在播放，则恢复播放
        if self.was_playing:
            self.media_player.play()
            if self.update_thread:
                self.update_thread.resume()
                if not self.update_thread.isRunning():
                    self.update_thread.start()
                self.update_thread.force_update()

    def on_subtitle_clicked(self, event):
        """处理字幕点击事件"""
        try:
            # 获取点击位置
            cursor = self.subtitle_display.cursorForPosition(event.pos())
            click_pos = cursor.position()
            
            # 查找点击的字幕块
            clicked_block = None
            for block in self.subtitle_blocks:
                if block['start'] <= click_pos <= block['end']:
                    clicked_block = block
                    break
            
            if clicked_block:
                # 计算时间位置
                subtitle_idx = clicked_block['index']
                if 0 <= subtitle_idx < len(self.subtitles):
                    # 设置播放位置到该字幕的开始时间
                    start_time = self.subtitles[subtitle_idx]['start_time']
                    self.media_player.setPosition(int(start_time))
                    
                    # 如果没在播放，开始播放
                    if self.media_player.state() != QMediaPlayer.PlayingState:
                        self.play_pause()
                    
                    # 强制更新字幕显示
                    self.update_subtitle_efficient(start_time)
                    if self.update_thread:
                        self.update_thread.force_update()
        
        except Exception as e:
            print(f"处理字幕点击事件时出错: {e}")

    def get_translation_cache_path(self):
        """获取翻译缓存文件路径"""
        try:
            # 确保当前文件的hash值存在
            if not hasattr(self, 'current_file_hash') or not self.current_file_hash:
                return None
                
            # 使用与字幕相同的文件名，但使用不同的后缀
            cache_path = self.subtitle_cache_dir / f"{self.current_file_hash}.json"
            return cache_path
            
        except Exception as e:
            logging.error(f"获取翻译缓存路径时出错: {e}")
            return None

    def save_translation_cache(self):
        """保存翻译缓存"""
        try:
            cache_file = self.get_translation_cache_path()
            if not cache_file:
                logging.warning("无法获取翻译缓存路径")
                return
                
            cache_data = {
                'translations': self.translations,  # 包含翻译文本和翻译器类型
                'timestamp': time.time()
            }
            
            with open(cache_file, 'w', encoding='utf-8') as f:
                json.dump(cache_data, f, ensure_ascii=False, indent=2)
            logging.info(f"已保存翻译缓存: {cache_file}")
            
        except Exception as e:
            logging.error(f"保存翻译缓存时出错: {e}")

    def load_translation_cache(self):
        """加载翻译缓存"""
        try:
            cache_file = self.get_translation_cache_path()
            if not cache_file or not cache_file.exists():
                return
                
            with open(cache_file, 'r', encoding='utf-8') as f:
                cached_data = json.load(f)
                self.translations = cached_data.get('translations', {})
                # 加载后更新翻译按钮状态
                if self.translations:
                    # 获取第一条翻译的类型
                    first_translation = next(iter(self.translations.values()))
                    translator_type = first_translation.get('translator', 'google')
                    self.update_translator_button_state(translator_type)
                logging.info(f"已加载翻译缓存: {cache_file}")
                
        except Exception as e:
            logging.error(f"加载翻译缓存时出错: {e}")
            self.translations = {}

# 添加一个新的ModernMacLineEdit类
class ModernMacLineEdit(QLineEdit):
    """macOS风格输入框"""
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFixedHeight(32)
        self.setStyleSheet("""
            QLineEdit {
                background-color: #F5F5F7;
                border: none;
                border-radius: 6px;
                padding: 0 12px;
                color: #1D1D1F;
                font-family: ".AppleSystemUIFont";
                font-size: 13px;
            }
            QLineEdit:focus {
                background-color: #FFFFFF;
                border: 2px solid #007AFF;
            }
            QLineEdit:disabled {
                background-color: #E5E5E5;
                color: #999999;
            }
            QLineEdit::placeholder {
                color: #999999;
            }
        """)

if __name__ == '__main__':
    app = QApplication(sys.argv)
    
    # 设置应用程序默认字体
    font = app.font()
    font.setFamily(".AppleSystemUIFont")  # 使用macOS系统字体
    app.setFont(font)
    
    app.setStyle('Fusion')
    player = PodcastPlayer()
    player.show()
    sys.exit(app.exec_())
