window.__ModuleLoader__.load({
  id: 'dsh-english-reader',
  factory(require) {
    const React = require('react')
    const { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } = React
    const h = React.createElement

    /** Tab-type identity: also the key the body registers under. */
    const TAB_ID = 'dsh-english-reader'
    /** The full-area page key, selected from the sidebar panel list. */
    const PANEL_ID = 'english-reader'
    /** Type discriminator the panel opens by. */
    const KIND = 'english-reader'
    /** Copy namespace. */
    const NS = 'englishReader'
    /** Where the panel keeps its library, position, and settings. */
    const STORAGE_KEY = 'dsh-english-reader:state:v2'
    /** The single-dialogue layout this plugin shipped first. */
    const LEGACY_KEY = 'dsh-english-reader:state:v1'
    const TTS_PATH = '/api-dsh-english-reader/tts'
    const LOCAL_STATUS = '/api-dsh-english-reader/local/status'
    const LOCAL_INSTALL = '/api-dsh-english-reader/local/install'
    const VALIDATE = '/api-dsh-english-reader/tts/validate'
    const MODELS = '/api-dsh-english-reader/tts/models'
    const VOICES = '/api-dsh-english-reader/tts/voices'
    const DICT_PATH = '/api-dsh-english-reader/dict'
    const DICT_AI = '/api-dsh-english-reader/dict/ai'
    const DICT_KEY = '/api-dsh-english-reader/dict/key'
    const SPEECH_SOURCE_PATH = '/api-dsh-english-reader/tts/sources'
    /** A home-directory path reads better (and wraps less) as `~/…`. */
    function shortPath(value) {
      return String(value).replace(/^(\/home\/[^/]+|\/Users\/[^/]+)\//, '~/')
    }

    /** Only a stored source record with a usable shape is loaded back. */
    function isSourceRecord(value) {
      if (value === null || typeof value !== 'object') return false
      if (typeof value.id !== 'string' || value.id === '') return false
      // Endpoint sources are stored on the host; only local folders live here.
      if (value.kind !== 'local') return false
      return typeof value.name === 'string' && typeof value.modelPath === 'string'
    }
    const TRANSLATE_PATH = '/api-dsh-english-reader/translate'
    const TRANSLATE_OPTIONS = '/api-dsh-english-reader/translate/options'
    const TRANSLATE_MODELS = '/api-dsh-english-reader/translate/models'
    /** Translation sources, in offering order. */
    // Microsoft and Tencent take keys from the plugin row's config, which the
    // panel cannot write, so offering them here would only ever fail.
    const SOURCES = ['dsh', 'google', 'volc']
    /** Sentences synthesized ahead of the one playing. */
    const PREFETCH = 3
    const SPEEDS = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]
    /** How many dialogues the library keeps. */
    const LIBRARY_LIMIT = 60

    const EDGE_VOICES = [
      { id: 'en-US-AriaNeural', label: 'Aria · US ♀' },
      { id: 'en-US-GuyNeural', label: 'Guy · US ♂' },
      { id: 'en-US-JennyNeural', label: 'Jenny · US ♀' },
      { id: 'en-US-ChristopherNeural', label: 'Christopher · US ♂' },
      { id: 'en-GB-SoniaNeural', label: 'Sonia · UK ♀' },
      { id: 'en-GB-RyanNeural', label: 'Ryan · UK ♂' },
      { id: 'en-AU-NatashaNeural', label: 'Natasha · AU ♀' },
      { id: 'en-US-EmmaMultilingualNeural', label: 'Emma · multilingual ♀' },
    ]

    const LOCAL_VOICES = [
      { id: 'af_heart', label: 'Heart · US ♀' },
      { id: 'af_bella', label: 'Bella · US ♀' },
      { id: 'af_sky', label: 'Sky · US ♀' },
      { id: 'am_michael', label: 'Michael · US ♂' },
      { id: 'am_fenrir', label: 'Fenrir · US ♂' },
      { id: 'am_puck', label: 'Puck · US ♂' },
      { id: 'bf_emma', label: 'Emma · UK ♀' },
      { id: 'bm_george', label: 'George · UK ♂' },
    ]

    const SAMPLE = [
      'Emma: Hi Daniel! You look tired.',
      'Daniel: I am. I studied until two in the morning.',
      'Emma: For the exam?',
      'Daniel: No, for fun. I was watching a documentary about whales.',
      'Emma: That does not sound like studying.',
      'Daniel: Well, I learned that a blue whale has a heart the size of a small car.',
    ].join('\n')

    const DICT = {
      en: {
        'tab.title': 'Dialogue reader',
        'guide.title': 'Dialogue reader',
        'guide.desc': 'Paste an English dialogue and hear it read in two voices, resuming where you stopped.',
        'launcher': 'Dialogue reader',
        'header.edit': 'Edit text',
        'library.edit': 'Edit this text',
        'header.library': 'Library',
        'display.width': 'Width',
        'dict.title': 'Dictionary',
        'settings.dict': 'Dictionary',
        'dict.show': 'Show',
        'dict.kind.both': 'Both',
        'dict.kind.en': 'English',
        'dict.kind.zh': 'Chinese',
        'dict.slot.cn': 'Chinese source',
        'dict.slot.en': 'English source',
        'dict.src.iciba': 'iciba (free)',
        'dict.src.wordnet': 'WordNet (free)',
        'dict.src.wiktionary': 'Wiktionary (free)',
        'dict.src.collins': 'Collins (needs a key)',
        'dict.src.model': 'Your model',
        'dict.modelProvider': 'Provider',
        'dict.modelName': 'Model',
        'dict.collinsKey': 'Collins key',
        'dict.collinsKeyHint': 'Your own Collins API access key',
        'dict.collinsStored': 'A key is stored on the host',
        'dict.collinsOnHost': 'Stored on the host, never in this browser.',
        'dict.collinsMissing': 'No key yet — Collins will answer with an error.',
        'dict.kindHint': 'Each language picks its own source; Show decides which of them the card prints. The model can be chosen separately for each.',
        'dict.placeholder': 'Look up a word or phrase',
        'dict.loading': 'Looking it up…',
        'dict.missing': 'No entry found. Try the phrase in the box above.',
        'dict.failed': 'The lookup failed. Check your network and try again.',
        'dict.hint': 'Right-click for the definition',
        'dict.save': 'Save word',
        'dict.saved': 'Saved',
        'words.title': 'Saved words',
        'words.filter': 'Filter words or meanings',
        'words.empty': 'No saved words yet. In the reader, right-click any word in the sentence being read.',
        'words.none': 'Nothing matches that filter.',
        'words.noGloss': 'No definition stored',
        'words.remove': 'Remove',
        'words.lookup': 'Open in the dictionary',
        'words.say': 'Read this word',
        'words.sayExample': 'Read the example',
        'words.sayContext': 'Read the source sentence',
        'words.context': 'From',
        'words.noContext': 'none',
        'words.emptyEntry': 'Neither dictionary has an entry for this word.',
        'backRow': 'Back to this dialogue',
        'display.width.narrow': 'Narrow',
        'display.width.mid': 'Medium',
        'display.width.wide': 'Wide',
        'display.custom': 'Custom',
        'display.widthCustom': 'Width as a share of the pane',
        'display.fontCustom': 'Reading font size in pixels',
        'display.percent': '% of pane',
        'display.px': 'px',
        'display.font.s': 'S',
        'display.font.m': 'M',
        'display.font.l': 'L',
        'display.font': 'Size',
        'panel.label': 'Read aloud',
        'empty.hint': 'Paste a dialogue below. Lines starting with "A:", "B:" or a name become turns with two alternating voices.',
        'empty.placeholder': 'Emma: Hi Daniel!\nDaniel: Hello, Emma. How are you?',
        'empty.sample': 'Use a sample',
        'voice.a': 'Voice A',
        'voice.b': 'Voice B',
        'mode.label': 'Read as',
        'mode.auto': 'Auto',
        'mode.article': 'Article',
        'mode.dialogue': 'Dialogue',
        'mode.hint.article': 'Article detected: one voice, wrapped lines joined back into sentences.',
        'mode.hint.dialogue': 'Dialogue detected: one voice per speaker.',
        'settings.title': 'Reading settings',
        'settings.engine': 'Engine',
        'settings.hint': 'Click outside to close',
        'engine.backend': 'Backend',
        'engine.backend.edge': 'Microsoft Edge neural voices',
        'engine.backend.local': 'onnx-community/Kokoro-82M-v1.0-ONNX',
        'engine.folder': 'Model folder',
        'engine.connection': 'Connection',
        'engine.connection.edge': 'Needs a network · text is sent to Microsoft',
        'engine.state': 'State',
        'source.label': 'Speech source',
        'source.edge.short': 'Edge',
        'source.local.short': 'Local model',
        'source.local.titled': 'Local model · Kokoro-82M',
        'source.local.model': 'Kokoro-82M',
        'source.builtin': 'Built in · nothing to set up',
        'source.bundled': 'Bundled model',
        'source.add': 'Add a source',
        'add.title': 'Add a speech source',
        'add.kind.api': 'TTS API',
        'add.kind.local': 'Local model',
        'add.name': 'Name',
        'add.id': 'Provider ID',
        'add.id.hint': 'Lowercase letters, digits and dashes. It identifies this source.',
        'add.protocol': 'Protocol',
        'add.protocol.openai': 'OpenAI-compatible /audio/speech',
        'add.protocol.auto': 'Detect automatically',
        'add.protocol.dashscope': 'Alibaba DashScope / Bailian (native)',
        'add.protocol.azure': 'Azure Speech (SSML)',
        'add.key': 'API key',
        'add.key.placeholder': 'sk-…',
        'add.key.hint': 'Stored on the host, never in this browser.',
        'add.err.badId': 'The provider ID may only use lowercase letters, digits and dashes.',
        'add.err.badBody': 'The request was not readable.',
        'add.err.bodyTooLarge': 'That request was too large.',
        'add.err.badProtocol': 'That protocol is not supported.',
        'add.err.methodNotAllowed': 'That operation is not allowed.',
        'add.err.modelsUnsupported': 'This protocol has no model list; name a voice instead.',
        'add.dir': 'Model folder',
        'add.dir.placeholder': '/path/to/a/model folder',
        'add.dir.hint': 'A folder holding config.json and an onnx/ model.',
        'add.pick': 'Choose…',
        'add.bundled.title': 'Bundled Kokoro-82M',
        'add.bundled.download': 'Download',
        'add.bundled.downloaded': 'Downloaded on this machine',
        'add.bundled.added': 'Added',
        'add.validating': 'Checking…',
        'add.fetchModels': 'Fetch models',
        'add.fetching': 'Fetching…',
        'add.test': 'Test',
        'add.testing': 'Testing…',
        'add.testOk': 'Connected',
        'add.keyUsed.request': 'used the key you typed',
        'add.keyUsed.stored': 'used the saved key',
        'add.keyUsed.none': 'sent no key at all',
        'add.modelPlaceholder': 'tts-1',
        'add.err.noModels': 'The endpoint listed no models.',
        'add.err.modelsFailed': 'Could not list the models of that endpoint.',
        'add.err.needUrl': 'Enter the endpoint before adding.',
        'add.err.needFolder': 'Choose a model folder before adding.',
        'add.err.duplicate': 'That source is already in the list.',
        'add.err.pathNotAbsolute': 'The folder path must be absolute.',
        'add.err.pathMissing': 'No folder at that path.',
        'add.err.pathNotFolder': 'That path is a file, not a folder.',
        'add.err.configMissing': 'config.json is missing from that folder.',
        'add.err.onnxMissing': 'No onnx model in that folder.',
        'add.err.urlInvalid': 'The endpoint must be an http(s) URL.',
        'add.err.timeout': 'The endpoint did not answer in time.',
        'add.err.endpointFailed': 'The endpoint did not answer.',
        'add.err.network': 'Could not reach this Harness.',
        'add.err.unknown': 'The source was refused.',
        'add.add': 'Add',
        'add.save': 'Save',
        'add.editTitle': 'Edit speech source',
        'custom.keyKeep': 'Leave empty to keep the stored key.',
        'source.custom': 'Custom TTS API',
        'state.online': 'Available online',
        'state.configured': 'Configured',
        'state.notConfigured': 'Not configured',
        'custom.baseUrl': 'Endpoint',
        'custom.model': 'Model',
        'custom.noEndpoint': 'No endpoint set',
        'settings.voices': 'Voices',
        'close': 'Close',
        'voice.pick': 'Pick or type a voice id',
        'voice.cloned': 'cloned',
        'voice.fromEndpoint': 'from endpoint',
        'voice.mine': 'added by you',
        'voice.add': 'Add this voice',
        'voice.manual': 'This service does not publish a voice list. Look the voice id up in its own documentation.',
        'voice.manualPlaceholder': 'voice id from the service docs',
        'rename': 'Rename',
        'editSource': 'Edit settings',
        'renamePrompt': 'New name',
        'pin': 'Pin',
        'unpin': 'Unpin',
        'voice.loading': 'Loading voices…',
        'voice.refresh': 'Refresh voices',
        'trans.title': 'Translation',
        'trans.show': 'Show translation',
        'trans.hide': 'Hide translation',
        'trans.source': 'Translate with',
        'trans.provider': 'Provider',
        'trans.model': 'Model',
        'trans.dsh': 'This Harness model',
        'trans.google': 'Google (free)',
        'trans.volc': 'Volcengine (free)',
        'trans.unavailable': 'not configured',
        'trans.working': 'Translating…',
        'trans.failed': 'Translation failed',
        'speed': 'Speed',
        'start': 'Start reading',
        'save': 'Save and read',
        'cancel': 'Cancel',
        'restart': 'Start over',
        'play': 'Play',
        'pause': 'Pause',
        'prev': 'Previous sentence',
        'next': 'Next sentence',
        'loop': 'Loop this sentence',
        'autoNext': 'Continue to the next sentence',
        'stopped': 'Stopped',
        'loading': 'Preparing audio…',
        'paused': 'Paused',
        'done': 'Finished',
        'resumed': 'resuming at sentence {n}',
        'autoplay': 'Audio is ready — press play',
        'empty.text': 'Paste a dialogue to start.',
        'delete': 'Delete',
        'deleteConfirm': 'Delete?',
        'untitled': 'Untitled dialogue',
        'provider.edge': 'Edge online',
        'provider.local': 'Local model',
        'local.desc': 'Kokoro-82M · about {size} MB · runs offline on this machine',
        'local.download': 'Download and use',
        'local.downloading': 'Downloading {n}%',
        'local.loading': 'Loading the model…',
        'local.ready': 'Downloaded · works offline',
        'local.cached': 'Downloaded · loads on the first sentence',
        'local.notReady': 'Not downloaded',
        'local.failed': 'Download failed',
        'local.retry': 'Retry',
        'library.title': 'My dialogues',
        'library.new': 'New dialogue',
        'library.empty': 'Nothing here yet. Paste your first dialogue and it will be kept.',
        'library.count': '{n} saved',
        'library.position': 'sentence {n} of {m}',
        'error.notInstalled': 'The local model is not downloaded yet',
        'error.preparing': 'The local model is still being prepared — try again in a moment',
        'error.network': 'Could not reach the speech service',
        'error.server': 'The speech service refused this sentence',
        'error.tooLong': 'This sentence is too long to synthesize',
        'error.generic': 'Could not prepare the audio',
        'retry': 'Try again',
      },
      zh: {
        'tab.title': '对话朗读',
        'guide.title': '对话朗读',
        'guide.desc': '粘贴一段英语对话，用两个声音朗读，并从上次停下的地方继续。',
        'launcher': '对话朗读',
        'header.edit': '编辑文本',
        'library.edit': '编辑这段文本',
        'header.library': '对话库',
        'display.width': '宽度',
        'dict.title': '字典',
        'settings.dict': '字典',
        'dict.show': '显示',
        'dict.kind.both': '中英',
        'dict.kind.en': '英英',
        'dict.kind.zh': '中文',
        'dict.slot.cn': '中文来源',
        'dict.slot.en': '英英来源',
        'dict.src.iciba': 'iciba（免费）',
        'dict.src.wordnet': 'WordNet（免费）',
        'dict.src.wiktionary': 'Wiktionary（免费）',
        'dict.src.collins': '柯林斯（需密钥）',
        'dict.src.model': '使用模型',
        'dict.modelProvider': '供应商',
        'dict.modelName': '模型',
        'dict.collinsKey': '柯林斯密钥',
        'dict.collinsKeyHint': '你自己的 Collins API access key',
        'dict.collinsStored': '宿主机已保存密钥',
        'dict.collinsOnHost': '密钥存在宿主机，不进入浏览器。',
        'dict.collinsMissing': '还没有密钥——柯林斯查询会直接报错。',
        'dict.kindHint': '中文和英英各选一个，互不影响；显示决定卡片里露哪几种。模型可以每种语言单独指定。',
        'dict.placeholder': '查单词或词组',
        'dict.loading': '正在查询…',
        'dict.missing': '没查到，试试在上面的输入框里查词组。',
        'dict.failed': '查询失败，检查网络后重试。',
        'dict.hint': '右键查看释义',
        'dict.save': '收藏单词',
        'dict.saved': '已收藏',
        'words.title': '我的单词',
        'words.filter': '筛选单词或释义',
        'words.empty': '还没有收藏的单词。在阅读时，右键正在朗读那句里的任意单词。',
        'words.none': '没有匹配的单词。',
        'words.noGloss': '未保存释义',
        'words.remove': '移除',
        'words.lookup': '在字典中打开',
        'words.say': '朗读这个单词',
        'words.sayExample': '朗读例句',
        'words.sayContext': '朗读原句',
        'words.context': '原文',
        'words.noContext': '无',
        'words.emptyEntry': '两个词典都没有这个词条。',
        'backRow': '返回当前对话',
        'display.width.narrow': '窄',
        'display.width.mid': '中',
        'display.width.wide': '宽',
        'display.custom': '自定义',
        'display.widthCustom': '按面板宽度的百分比设置',
        'display.fontCustom': '按像素设置正文字号',
        'display.percent': '% 面板宽',
        'display.px': 'px',
        'display.font.s': '小',
        'display.font.m': '中',
        'display.font.l': '大',
        'display.font': '字号',
        'panel.label': '对话朗读',
        'empty.hint': '把对话粘贴到下面。以「A:」「B:」或人名开头的行会变成对话轮次，用两个音色轮流朗读。',
        'empty.placeholder': 'Emma: Hi Daniel!\nDaniel: Hello, Emma. How are you?',
        'empty.sample': '用示例试试',
        'voice.a': '角色 A',
        'voice.b': '角色 B',
        'mode.label': '朗读方式',
        'mode.auto': '自动',
        'mode.article': '文章',
        'mode.dialogue': '对话',
        'mode.hint.article': '已识别为文章：单音色朗读，跨行的断句已重新合并。',
        'mode.hint.dialogue': '已识别为对话：每个说话人一个音色。',
        'settings.title': '朗读设置',
        'settings.engine': '引擎',
        'settings.hint': '点击外部关闭',
        'engine.backend': '后端',
        'engine.backend.edge': '微软 Edge 神经语音',
        'engine.backend.local': 'onnx-community/Kokoro-82M-v1.0-ONNX',
        'engine.folder': '模型目录',
        'engine.connection': '连接',
        'engine.connection.edge': '需要联网 · 文本发送到微软',
        'engine.state': '状态',
        'source.label': 'TTS 来源',
        'source.edge.short': 'Edge',
        'source.local.short': '本地模型',
        'source.local.titled': '本地模型 · Kokoro-82M',
        'source.local.model': 'Kokoro-82M',
        'source.builtin': '内置 · 无需配置',
        'source.bundled': '内置模型',
        'source.add': '添加来源',
        'add.title': '添加语音来源',
        'add.kind.api': 'TTS API',
        'add.kind.local': '本地模型',
        'add.name': '显示名称',
        'add.id': '供应商 ID',
        'add.id.hint': '小写字母、数字和连字符。用它唯一标识这个来源。',
        'add.protocol': 'API 协议',
        'add.protocol.openai': 'OpenAI 兼容 /audio/speech',
        'add.protocol.auto': '自动探测（推荐）',
        'add.protocol.dashscope': '阿里云百炼 / DashScope（原生接口）',
        'add.protocol.azure': 'Azure 语音（SSML）',
        'add.key': 'API 密钥',
        'add.key.placeholder': 'sk-…',
        'add.key.hint': '保存在宿主，不写入浏览器。',
        'add.err.badId': '供应商 ID 只能用小写字母、数字和连字符。',
        'add.err.badBody': '请求无法解析。',
        'add.err.bodyTooLarge': '请求体过大。',
        'add.err.badProtocol': '不支持这个协议。',
        'add.err.methodNotAllowed': '不允许这个操作。',
        'add.err.modelsUnsupported': '这个协议没有模型列表，请直接填写音色名。',
        'add.dir': '模型目录',
        'add.dir.placeholder': '/模型目录的绝对路径',
        'add.dir.hint': '目录里要有 config.json 和 onnx/ 模型。',
        'add.pick': '选择…',
        'add.bundled.title': '内置 Kokoro-82M',
        'add.bundled.download': '下载',
        'add.bundled.downloaded': '已下载到这台机器',
        'add.bundled.added': '已添加',
        'add.validating': '校验中…',
        'add.fetchModels': '获取可用模型',
        'add.fetching': '获取中…',
        'add.test': '测试连接',
        'add.testing': '测试中…',
        'add.testOk': '连接成功',
        'add.keyUsed.request': '用的是你刚填的密钥',
        'add.keyUsed.stored': '用的是已保存的密钥',
        'add.keyUsed.none': '根本没有发送密钥',
        'add.modelPlaceholder': 'tts-1',
        'add.err.noModels': '这个端点没有列出任何模型。',
        'add.err.modelsFailed': '无法获取这个端点的模型列表。',
        'add.err.needUrl': '先填地址再添加。',
        'add.err.needFolder': '先选模型目录再添加。',
        'add.err.duplicate': '这个来源已经在列表里了。',
        'add.err.pathNotAbsolute': '模型目录必须是绝对路径。',
        'add.err.pathMissing': '这个路径下没有目录。',
        'add.err.pathNotFolder': '这个路径是一个文件，不是目录。',
        'add.err.configMissing': '这个目录里缺少 config.json。',
        'add.err.onnxMissing': '这个目录里没有 onnx 模型。',
        'add.err.urlInvalid': '地址必须是 http(s) URL。',
        'add.err.timeout': '端点没有在限定时间内应答。',
        'add.err.endpointFailed': '端点没有正常应答。',
        'add.err.network': '连不上这个 Harness。',
        'add.err.unknown': '这个来源没有被接受。',
        'add.add': '添加',
        'add.save': '保存',
        'add.editTitle': '编辑语音来源',
        'custom.keyKeep': '留空表示沿用已保存的密钥。',
        'source.custom': '自定义 TTS API',
        'state.online': '在线可用',
        'state.configured': '已配置',
        'state.notConfigured': '未配置',
        'custom.baseUrl': '地址',
        'custom.model': '模型',
        'custom.noEndpoint': '还没有填地址',
        'settings.voices': '音色',
        'close': '关闭',
        'voice.pick': '选择或输入音色 ID',
        'voice.cloned': '复刻',
        'voice.fromEndpoint': '端点提供',
        'voice.mine': '你添加的',
        'voice.add': '添加当前音色',
        'voice.manual': '这个服务不提供音色列表，请到该服务自己的文档里查音色 ID。',
        'voice.manualPlaceholder': '服务文档里的音色 ID',
        'rename': '重命名',
        'editSource': '编辑设置',
        'renamePrompt': '新名称',
        'pin': '置顶',
        'unpin': '取消置顶',
        'voice.loading': '读取音色中…',
        'voice.refresh': '读取音色列表',
        'trans.title': '翻译',
        'trans.show': '显示翻译',
        'trans.hide': '隐藏翻译',
        'trans.source': '翻译来源',
        'trans.provider': '供应商',
        'trans.model': '模型',
        'trans.dsh': 'DSH 自带模型',
        'trans.google': '谷歌（免费）',
        'trans.volc': '火山翻译（免费）',
        'trans.unavailable': '未配置',
        'trans.working': '正在翻译…',
        'trans.failed': '翻译失败',
        'speed': '语速',
        'start': '开始朗读',
        'save': '保存并朗读',
        'cancel': '取消',
        'restart': '从头开始',
        'play': '播放',
        'pause': '暂停',
        'prev': '上一句',
        'next': '下一句',
        'loop': '单句循环',
        'autoNext': '连读下一句',
        'stopped': '已停止',
        'loading': '正在准备语音…',
        'paused': '已暂停',
        'done': '已读完',
        'resumed': '将从第 {n} 句继续',
        'autoplay': '语音已就绪 — 请按播放键',
        'empty.text': '粘贴一段对话就能开始。',
        'delete': '删除',
        'deleteConfirm': '确认删除？',
        'untitled': '未命名对话',
        'provider.edge': 'Edge 在线',
        'provider.local': '本地模型',
        'local.desc': 'Kokoro-82M · 约 {size} MB · 在这台机器上离线运行',
        'local.download': '下载并使用',
        'local.downloading': '正在下载 {n}%',
        'local.loading': '正在加载模型…',
        'local.ready': '已下载 · 可离线使用',
        'local.cached': '已下载 · 第一句时加载模型',
        'local.notReady': '未下载',
        'local.failed': '下载失败',
        'local.retry': '重试',
        'library.title': '我的对话',
        'library.new': '新建对话',
        'library.empty': '还没有对话。粘贴第一段就会自动保存。',
        'library.count': '已保存 {n} 个',
        'library.position': '第 {n} 句 / 共 {m} 句',
        'error.notInstalled': '本地模型还没下载',
        'error.preparing': '本地模型还在准备中，稍等一下再试',
        'error.network': '连不上语音服务',
        'error.server': '语音服务拒绝了这一句',
        'error.tooLong': '这一句太长，无法合成',
        'error.generic': '语音准备失败',
        'retry': '重试',
      },
    }

    /** Resolve a dictionary entry, filling `{n}` style placeholders. */
    function fill(text, vars) {
      if (vars === undefined) return text
      return String(text).replace(/\{(\w+)\}/g, (whole, key) => (key in vars ? String(vars[key]) : whole))
    }

    /** FNV-1a, so a re-pasted dialogue is recognized as the same one. */
    function hashText(value) {
      let hash = 2166136261
      for (let i = 0; i < value.length; i += 1) {
        hash ^= value.charCodeAt(i)
        hash = Math.imul(hash, 16777619)
      }
      return (hash >>> 0).toString(36)
    }

    const ABBREVIATIONS = new Set([
      'mr.', 'mrs.', 'ms.', 'dr.', 'prof.', 'st.', 'jr.', 'sr.', 'vs.', 'etc.',
      'e.g.', 'i.e.', 'u.s.', 'a.m.', 'p.m.', 'fig.', 'no.', 'vol.', 'inc.', 'ltd.',
    ])

    /**
     * Split one turn into sentences, keeping closing quotes with the sentence and
     * rejoining decimals and abbreviations so a TTS request never ends mid-number.
     */
    function splitSentences(value) {
      const text = String(value).replace(/\s+/g, ' ').trim()
      if (text === '') return []
      const raw = text.match(/[^.!?…]+[.!?…]+["'”’)\]]*|[^.!?…]+$/g) ?? [text]
      const out = []
      for (const piece of raw) {
        const part = piece.trim()
        if (part === '') continue
        if (out.length > 0) {
          const previous = out[out.length - 1]
          const decimal = /\d\.$/.test(previous) && /^\d/.test(part)
          const tail = (previous.match(/[A-Za-z.]+\.$/) ?? [''])[0].toLowerCase()
          const initial = /^[a-z]\.$/i.test(tail)
          const abbreviation = ABBREVIATIONS.has(tail) || initial
          if (decimal || abbreviation) {
            const glue = decimal || initial ? '' : ' '
            out[out.length - 1] = `${previous}${glue}${part}`
            continue
          }
        }
        out.push(part)
      }
      return out.length === 0 ? [text] : out
    }

    /**
     * `Name: text` — a short label (latin or CJK) followed by a colon or a
     * full-width colon. At most two words, so ordinary prose stays prose.
     */
    const SPEAKER = /^([A-Za-z\u4e00-\u9fff][A-Za-z0-9\u4e00-\u9fff.'’\-]*(?: [A-Za-z0-9\u4e00-\u9fff.'’\-]+)?)\s*[:：]\s*(.+)$/

    /** Sentence-final punctuation, optionally followed by closing quotes or brackets. */
    const TERMINAL = /[.!?…:]["'”’)\]]*$/

    /**
     * Read the pasted text into source lines, splitting off a speaker label.
     * A blank line is remembered on the next entry, because it is the only
     * reliable paragraph separator a paste carries.
     */
    function readLines(raw) {
      const entries = []
      let pendingBlank = false
      for (const rawLine of String(raw).split(/\r?\n/)) {
        const trimmed = rawLine.trim()
        if (trimmed === '') { pendingBlank = true; continue }
        const match = trimmed.match(SPEAKER)
        entries.push({
          speaker: match === null ? null : match[1].trim(),
          text: match === null ? trimmed : match[2].trim(),
          hardBreak: pendingBlank,
        })
        pendingBlank = false
      }
      return entries
    }

    /**
     * Decide whether the paste is a dialogue or an article.
     *
     * A dialogue is text where several distinct short labels act as turns; an
     * article that happens to contain one `Note:` line is still an article. The
     * caller can override this either way.
     */
    function detectMode(entries) {
      const speakers = []
      let labelled = 0
      for (const entry of entries) {
        if (entry.speaker === null) continue
        labelled += 1
        if (!speakers.includes(entry.speaker)) speakers.push(entry.speaker)
      }
      const coverage = entries.length === 0 ? 0 : labelled / entries.length
      return speakers.length >= 2 && labelled >= 2 && coverage >= 0.25 ? 'dialogue' : 'article'
    }

    /**
     * Turn pasted text into ordered sentences.
     *
     * Wrapped prose arrives with a newline at every visual line end, so a line
     * that does not end a sentence is joined to the next one before anything is
     * split — otherwise the reader would synthesize half a sentence and stop in
     * the middle of it. A blank line, a speaker label or a finished sentence all
     * end a turn.
     *
     * @param {string} raw - the pasted text.
     * @param {'auto'|'dialogue'|'article'} requestedMode - the reader's choice.
     * @returns {{sentences: Array<object>, speakers: string[], mode: string, detected: string}} the parse.
     */
    function parseDialogue(raw, requestedMode) {
      const entries = readLines(raw)
      const detected = detectMode(entries)
      const mode = requestedMode === 'dialogue' || requestedMode === 'article' ? requestedMode : detected
      const speakers = []
      for (const entry of entries) {
        if (entry.speaker !== null && !speakers.includes(entry.speaker)) speakers.push(entry.speaker)
      }

      // Join soft-wrapped lines into turns.
      const turns = []
      let paragraph = 0
      for (const entry of entries) {
        const previous = turns[turns.length - 1]
        const continues = previous !== undefined
          && !entry.hardBreak
          && entry.speaker === null
          && !TERMINAL.test(previous.text)
        if (continues) {
          previous.text = `${previous.text} ${entry.text}`
          continue
        }
        if (entry.hardBreak || previous === undefined) paragraph += 1
        turns.push({ speaker: entry.speaker, text: entry.text, paragraph, turn: turns.length })
      }

      const sentences = []
      for (const turn of turns) {
        for (const part of splitSentences(turn.text)) {
          sentences.push({
            text: part,
            speaker: turn.speaker,
            slot: mode === 'dialogue' && turn.speaker !== null ? speakers.indexOf(turn.speaker) % 2 : 0,
            paragraph: turn.paragraph,
            turn: turn.turn,
          })
        }
      }

      // A dialogue pasted without labels still alternates, but per turn rather
      // than per source line, so a wrapped turn is not read by two voices.
      if (mode === 'dialogue' && speakers.length === 0) {
        const slotByTurn = new Map()
        let counter = 0
        for (const sentence of sentences) {
          if (!slotByTurn.has(sentence.turn)) {
            slotByTurn.set(sentence.turn, counter % 2)
            counter += 1
          }
          sentence.slot = slotByTurn.get(sentence.turn)
        }
      }

      return { sentences, speakers, mode, detected }
    }

    /** The library row's title: the first turn, trimmed to something readable. */
    function titleFor(raw) {
      const first = String(raw).split(/\r?\n/).map((line) => line.trim()).find((line) => line !== '')
      if (first === undefined) return ''
      const parsed = first.match(SPEAKER)
      const body = parsed === null ? first : parsed[2]
      const clean = body.replace(/\s+/g, ' ').trim()
      return clean.length > 46 ? `${clean.slice(0, 45)}…` : clean
    }

    /** Every non-whitespace run in a sentence, in order. */
    function wordsOf(text) {
      return String(text).split(/(\s+)/).filter((part) => part !== '' && !/^\s+$/.test(part))
    }

    /** A word reduced to the characters a speech engine reports in its marks. */
    function normalizeWord(value) {
      return String(value).toLowerCase().replace(/[^a-z0-9']/g, '')
    }

    /**
     * Turn boundary marks into a start time per rendered word.
     *
     * Edge reports one mark per spoken token, which is not one per whitespace
     * token ("left—but" is two marks, '"stop!"' is one) — so words are matched by
     * their normalized text instead of by index. With no marks at all (the local
     * model) the audio length is spread over the words by their length.
     *
     * @param {string[]} words - rendered words.
     * @param {Array<{text: string, at: number, dur: number}>} marks - engine marks, in ms.
     * @param {number} durationMs - the clip's length, when known.
     * @returns {number[]} a start time in ms per word.
     */
    function buildTimings(words, marks, durationMs) {
      if (marks.length > 0) {
        const times = new Array(words.length).fill(marks[0].at)
        let cursor = 0
        for (let position = 0; position < words.length; position += 1) {
          const target = normalizeWord(words[position])
          if (cursor < marks.length) times[position] = marks[cursor].at
          if (target === '') continue
          let consumed = ''
          while (cursor < marks.length && consumed.length < target.length) {
            consumed += normalizeWord(marks[cursor].text)
            cursor += 1
          }
        }
        return times
      }
      const total = durationMs > 0 ? durationMs : Math.max(1200, words.join(' ').length * 62)
      const weights = words.map((word) => Math.max(1, word.length))
      const weight = weights.reduce((sum, value) => sum + value, 0)
      const times = []
      let travelled = 0
      for (const value of weights) {
        times.push((travelled / weight) * total)
        travelled += value
      }
      return times
    }

    /** Read the base64 mark table the host put on the audio response. */
    function decodeMarks(value) {
      if (typeof value !== 'string' || value === '') return []
      try {
        const parsed = JSON.parse(window.atob(value))
        return Array.isArray(parsed) ? parsed : []
      } catch { return [] }
    }

    /** Keep only a value the pairing selects can actually show. */
    function pickVoice(value, list, fallback) {
      return list.some((voice) => voice.id === value) ? value : fallback
    }

    function pickRate(value) {
      return SPEEDS.includes(value) ? value : 1
    }

    /** Senses are a list now; the first release stored a plain string. */
    function sensesOf(value) {
      if (Array.isArray(value)) {
        return value
          .filter((sense) => sense !== null && typeof sense === 'object')
          .map((sense) => ({
            pos: String(sense.pos ?? ''),
            def: String(sense.def ?? ''),
            example: String(sense.example ?? ''),
          }))
      }
      if (typeof value === 'string' && value.trim() !== '') return [{ pos: '', def: value, example: '' }]
      return []
    }

    /** A stable id without depending on crypto availability. */
    function makeId() {
      return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
    }

    /** Read the remembered panel state, migrating the first release's layout. */
    function loadState() {
      try {
        const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null')
        if (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.items)) return parsed
      } catch { /* fall through to migration */ }
      try {
        const legacy = JSON.parse(window.localStorage.getItem(LEGACY_KEY) ?? 'null')
        if (legacy !== null && typeof legacy === 'object' && typeof legacy.text === 'string' && legacy.text.trim() !== '') {
          return {
            version: 2,
            activeId: 'legacy',
            provider: 'edge',
            items: [{
              id: 'legacy',
              title: titleFor(legacy.text),
              text: legacy.text,
              index: Number.isInteger(legacy.index) ? legacy.index : 0,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            }],
            edgeA: legacy.voiceA,
            edgeB: legacy.voiceB,
            rate: legacy.rate,
            loop: legacy.loop,
          }
        }
      } catch { /* nothing to migrate */ }
      return {}
    }

    /** Format a byte count for the model card. */
    function megabytes(bytes) {
      const value = Number(bytes) > 0 ? Number(bytes) : 89 * 1024 * 1024
      return String(Math.round(value / (1024 * 1024)))
    }

    /** `useSyncExternalStore` with a fallback for a React without it. */
    const useSnapshot = typeof React.useSyncExternalStore === 'function'
      ? React.useSyncExternalStore
      : (subscribe, getSnapshot) => {
        const [value, setValue] = useState(getSnapshot)
        useEffect(() => subscribe(() => setValue(getSnapshot())), [subscribe])
        return value
      }

    /** One circle glyph for the player. */
    function glyph(path, size) {
      const box = size ?? 18
      return h('svg', { viewBox: '0 0 24 24', width: box, height: box, 'aria-hidden': true, focusable: 'false' },
        h('path', { d: path, fill: 'currentColor' }))
    }

    /** Line-art variant: some shapes are illegible as a filled path at 16px. */
    function glyphLine(paths, size, viewBox) {
      const box = size ?? 18
      return h('svg', {
        viewBox: viewBox ?? '0 0 24 24', width: box, height: box, 'aria-hidden': true, focusable: 'false',
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
        strokeLinecap: 'round', strokeLinejoin: 'round',
      }, paths.map((d, at) => h('path', { key: at, d })))
    }

    /** The headset glyph sits one pixel low in a 24x24 grid; shift the window up. */
    const HEADSET_BOX = '0 1 24 24'

    const ICON = {
      play: 'M8 5.5v13l11-6.5z',
      pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
      prev: 'M7 5h2v14H7zm11 0v14l-9-7z',
      next: 'M15 5h2v14h-2zM6 5l9 7-9 7z',
      chain: 'M4 12h6v2H4zm10 0h6v2h-6zM9 7h6v2H9zm0 8h6v2H9z',
      // An open book with an A on the page: the dictionary, unmistakably.
      book: [
        'M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20',
        'm8 13 4-7 4 7',
        'M9.1 11h5.7',
      ],
      speaker: 'M4 9h3l4-4v14l-4-4H4zm12.5-1.5a6 6 0 0 1 0 9l-1.4-1.4a4 4 0 0 0 0-6.2zM14 4.6a10 10 0 0 1 0 14.8l-1.4-1.4a8 8 0 0 0 0-12z',
      repeat: 'M7 7h8V4l4 4-4 4V9H9v4H7zm10 10H9v3l-4-4 4-4v3h6v-4h2z',
      edit: 'M4 17.2V20h2.8L17 9.8 14.2 7 4 17.2zM19.7 7.3a1 1 0 0 0 0-1.4l-1.6-1.6a1 1 0 0 0-1.4 0l-1.2 1.2 3 3z',
      rename: 'M5 8h9v2H5zm0 5h6v2H5zM16.5 15.6l1.4-1.4 1.9 1.9-1.4 1.4zM14 17.1l2.3 2.3-2.9.6z',
      restart: 'M12 5V2L7.5 6 12 10V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z',
      headset: [
        'M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H4a1 1 0 0 1-1-1v-7a9 9 0 0 1 18 0v7a1 1 0 0 1-1 1h-2a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3',
      ],
      library: 'M4 5h3v14H4zm5 0h3v14H9zm5 0h2.6l3 14-2.6.5z',
      plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
      close: 'M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z',
      translate: 'M3 5h7v1.7H3zm0 3.7h5.2v1.7H3zm0 3.7h7V14H3zm10.4-7.4h2.2l3.4 9h-2.1l-.7-2h-3.4l-.7 2h-2.1zM14.5 7.1 13.2 11h2.6z',
      caret: 'M7 10l5 5 5-5z',
      pin: 'M14 3l7 7-2 2-1-1-3 3v3l-2 2-4-4-4 4-1-1 4-4-4-4 2-2h3l3-3-1-1z',
      settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm9 4-.1 1.4 2 1.5-1.7 3-2.3-.9a7 7 0 0 1-2.4 1.4L16 21h-3l-.5-2.6a7 7 0 0 1-2.4-1.4l-2.3.9L6 14.9l2-1.5L8 12l.1-1.4-2-1.5 1.7-3 2.3.9a7 7 0 0 1 2.4-1.4L12.5 3h3l.5 2.6a7 7 0 0 1 2.4 1.4l2.3-.9 1.7 3-2 1.5z',
      download: 'M11 4h2v9.2l3.6-3.6L18 11l-6 6-6-6 1.4-1.4L11 13.2z',
    }

    /** The guide card's glyph. */
    function GuideGlyph(props) {
      return glyphLine(ICON.headset, props?.size ?? 20, HEADSET_BOX)
    }

    /**
     * The panel: a dialogue library, a paste box, and a sentence list that
     * follows the audio.
     * @param {{localeSource: object}} props - the observable locale projection.
     */
    /**
     * The panel is the last thing between a render mistake and a blank tab:
     * a thrown error unmounts the tree with nothing to show for it, so the
     * failure is caught here and printed instead.
     */
    function Reader(props) {
      try {
        return ReaderBody(props)
      } catch (error) {
        const text = String(error?.stack ?? error?.message ?? error)
        return h('div', { className: 'er-fatal' },
          h('p', { className: 'er-fatal-title' }, 'English reader failed to render'),
          h('pre', { className: 'er-fatal-body' }, text.slice(0, 1200)))
      }
    }

    function ReaderBody(props) {
      const { pickDirectory } = props
      const localeId = useSnapshot(props.localeSource.subscribe, props.localeSource.getSnapshot)
      const dict = DICT[String(localeId).toLowerCase().startsWith('zh') ? 'zh' : 'en']
      const t = useCallback((key, vars) => fill(dict[key] ?? key, vars), [dict])

      const initial = useMemo(() => loadState(), [])
      const initialItems = Array.isArray(initial.items) ? initial.items.filter((item) => item !== null
        && typeof item === 'object' && typeof item.text === 'string') : []
      const initialActive = initialItems.some((item) => item.id === initial.activeId) ? initial.activeId : (initialItems[0]?.id ?? '')

      const [items, setItems] = useState(initialItems)
      const [activeId, setActiveId] = useState(initialActive)
      const [index, setIndex] = useState(() => {
        const item = initialItems.find((candidate) => candidate.id === initialActive)
        if (!Number.isInteger(item?.index)) return 0
        // The stored text may have been edited shorter since the position was
        // written, so clamp against what it parses to now.
        const count = parseDialogue(item.text, item.mode).sentences.length
        return Math.max(0, Math.min(item.index, Math.max(0, count - 1)))
      })
      const [extraSources, setExtraSources] = useState(() => (Array.isArray(initial.sources) ? initial.sources.filter(isSourceRecord) : []))
      const [activeSourceId, setActiveSourceId] = useState(typeof initial.activeSourceId === 'string' ? initial.activeSourceId : 'edge')
      /** The add-a-source dialog, and its draft fields. */
      const [addOpen, setAddOpen] = useState(false)
      /** Set while the add dialog is waiting for the bundled download to land. */
      const [awaitBundled, setAwaitBundled] = useState(false)
      /** Why the last attempt to add a source was refused. */
      const [addError, setAddError] = useState('')
      const [validating, setValidating] = useState(false)
      /** Endpoint sources stored by the host, and the form's own controls. */
      const [apiSources, setApiSources] = useState([])
      const [apiModels, setApiModels] = useState([])
      /** Voice ids worth offering for the active endpoint source. */
      const [voiceChoices, setVoiceChoices] = useState([])
      const [voicesListed, setVoicesListed] = useState(false)
      const [loadingVoices, setLoadingVoices] = useState(false)
      const [fetchingModels, setFetchingModels] = useState(false)
      const [probe, setProbe] = useState({ state: 'idle', message: '' })
      const [addKind, setAddKind] = useState('api')
      const [draftName, setDraftName] = useState('')
      const [draftBaseUrl, setDraftBaseUrl] = useState('')
      const [draftModel, setDraftModel] = useState('')
      const [draftPath, setDraftPath] = useState('')
      const [draftId, setDraftId] = useState('')
      const [draftProtocol, setDraftProtocol] = useState('auto')
      const [draftKey, setDraftKey] = useState('')
      const [edgeA, setEdgeA] = useState(() => pickVoice(initial.edgeA, EDGE_VOICES, EDGE_VOICES[0].id))
      const [edgeB, setEdgeB] = useState(() => pickVoice(initial.edgeB, EDGE_VOICES, EDGE_VOICES[1].id))
      const [rate, setRate] = useState(() => pickRate(initial.rate))
      const [loop, setLoop] = useState(() => initial.loop === true)
      const [autoNext, setAutoNext] = useState(() => initial.autoNext !== false)
      const [draft, setDraft] = useState('')
      const [draftMode, setDraftMode] = useState(() => initialItems.find((item) => item.id === initialActive)?.mode ?? 'auto')
      const [editingId, setEditingId] = useState(null)
      const [view, setView] = useState(initialItems.length === 0 ? 'editor' : 'reader')
      /** Where the current page was entered from, so Back can return there. */
      const returnView = useRef('reader')
      const goView = useCallback((next) => {
        setView((current) => {
          if (next !== current) returnView.current = current
          return next
        })
      }, [])
      const [status, setStatus] = useState('idle')
      const [errorKind, setErrorKind] = useState('')
      const [noticeKey, setNoticeKey] = useState(() => {
        const item = initialItems.find((candidate) => candidate.id === initialActive)
        return Number.isInteger(item?.index) && item.index > 0 ? 'resumed' : ''
      })
      const [confirmDelete, setConfirmDelete] = useState('')
      /** The reading measure the user dragged, and how wide the panel actually is. */
      const [columnWidth, setColumnWidth] = useState(() => (typeof initial.columnWidth === 'number' && initial.columnWidth > 0 ? initial.columnWidth : 0))
      const [panelWidth, setPanelWidth] = useState(0)
      const [panelHeight, setPanelHeight] = useState(0)
      const [fontScale, setFontScale] = useState(() => (typeof initial.fontScale === 'number' && initial.fontScale > 0 ? initial.fontScale : 1))
      /** Exact values typed by the user: a share of the pane, and a font size in px. */
      const [customPct, setCustomPct] = useState(() => (typeof initial.customPct === 'number' && initial.customPct > 0 ? initial.customPct : 0))
      const [customPx, setCustomPx] = useState(() => (typeof initial.customPx === 'number' && initial.customPx > 0 ? initial.customPx : 0))
      const [editingWidth, setEditingWidth] = useState(false)
      const [editingFont, setEditingFont] = useState(false)
      const [widthDraft, setWidthDraft] = useState('')
      const [fontDraft, setFontDraft] = useState('')
      /** Which library entry or source is being renamed, and to what. */
      const [renamingItem, setRenamingItem] = useState('')
      /** The word card: where it is anchored, and what it shows. */
      const [card, setCard] = useState(null)
      const cardRef = useRef(null)
      cardRef.current = card
      const [cardEntry, setCardEntry] = useState(null)
      const [cardState, setCardState] = useState('idle')
      const [cardError, setCardError] = useState('')
      const [query, setQuery] = useState('')
      const [words, setWords] = useState(() => (Array.isArray(initial.words) ? initial.words : [])
        .filter((item) => item !== null && typeof item === 'object' && typeof item.word === 'string')
        .map((item) => ({
          ...item,
          id: String(item.id ?? item.word).toLowerCase(),
          senses: sensesOf(item.senses),
          translation: sensesOf(item.translation),
          // A context that does not contain the word came from a search, not
          // from a sentence; earlier releases stored the reading position.
          context: typeof item.context === 'string'
            && item.context.toLowerCase().includes(String(item.word).toLowerCase())
            ? item.context
            : '',
        })))
      const [wordFilter, setWordFilter] = useState('')
      const [openWordId, setOpenWordId] = useState('')
      const [openLoading, setOpenLoading] = useState(false)
      /** What a lookup shows: English definitions, a Chinese gloss, or both. */
      /** Two slots, one per language: each picks its own dictionary. */
      /** What the card shows: both languages, English only, or Chinese only. */
      const [dictShow, setDictShow] = useState(() => (['both', 'en', 'zh'].includes(initial.dictShow) ? initial.dictShow : 'both'))
      const [dictCn, setDictCn] = useState(() => (['iciba', 'model'].includes(initial.dictCn) ? initial.dictCn : 'iciba'))
      const [dictEn, setDictEn] = useState(() => (['wordnet', 'wiktionary', 'collins', 'model'].includes(initial.dictEn) ? initial.dictEn : 'wordnet'))
      /** Whether the host holds a Collins key; the key itself never reaches the browser. */
      const [collinsReady, setCollinsReady] = useState(false)
      const [collinsDraft, setCollinsDraft] = useState('')
      const [collinsSaved, setCollinsSaved] = useState(false)
      /** Which model writes entries; defaults to the translation route. */
      const [dictModelCn, setDictModelCn] = useState(() => (initial.dictModelCn !== null && typeof initial.dictModelCn === 'object'
        ? initial.dictModelCn : null))
      const [dictModelEn, setDictModelEn] = useState(() => (initial.dictModelEn !== null && typeof initial.dictModelEn === 'object'
        ? initial.dictModelEn : null))
      /** Model lists per provider, for whichever slot asks for one. */
      const [modelsByProvider, setModelsByProvider] = useState({})
      /** Model-written entries, keyed by word, so a kind switch never pays twice. */
      const [aiEntries, setAiEntries] = useState(() => (initial.aiEntries !== null && typeof initial.aiEntries === 'object' ? initial.aiEntries : {}))
      const [renamingSource, setRenamingSource] = useState('')
      /** When set, the dialog edits this source instead of adding one. */
      const [editingSource, setEditingSource] = useState('')
      const [nameDraft, setNameDraft] = useState('')
      const [showTranslation, setShowTranslation] = useState(initial.showTranslation === true)
      const [translateSource, setTranslateSource] = useState(() => (SOURCES.includes(initial.translateSource) ? initial.translateSource : 'dsh'))
      const [translateModel, setTranslateModel] = useState(initial.translateModel ?? null)
      const [translateOptions, setTranslateOptions] = useState(null)
      const [translateRoute, setTranslateRoute] = useState(() => (
        typeof initial.translateModel?.provider === 'string' ? initial.translateModel.provider : ''))
      const [routes, setRoutes] = useState([])
      const [modelChoices, setModelChoices] = useState([])
      /** Which model writes dictionary entries; declared after the states it reads. */
      const routeOf = (slot) => slot?.provider ?? translateRoute
      const modelOf = (slot) => slot?.model ?? translateModel?.model ?? ''
      const [translating, setTranslating] = useState(false)
      const [translateError, setTranslateError] = useState('')
      const [settingsOpen, setSettingsOpen] = useState(false)
      const [sheetPlace, setSheetPlace] = useState(null)
      const [model, setModel] = useState(null)
      /** Where the bundled model sits on disk, shown as the source's location. */
      const [modelDir, setModelDir] = useState('')

      const audioRef = useRef(null)
      const rootRef = useRef(null)
      const capsuleRef = useRef(null)
      const listRef = useRef(null)
      const rowRefs = useRef([])
      const cacheRef = useRef(new Map())
      const inflightRef = useRef(new Map())
      const tokenRef = useRef(0)
      const disposedRef = useRef(false)
      const saveRef = useRef(null)
      const stateRef = useRef({ index: 0, sentences: [], voiceA: '', voiceB: '', provider: 'edge', rate: 1, loop: false, autoNext: true, status: 'idle' })
      /** Rendered word spans of the sentence on screen, and which one is lit. */
      const wordRefs = useRef([])
      const sayRef = useRef(null)
      const [sayingKey, setSayingKey] = useState('')
      const activeWordRef = useRef(-1)
      /** Marks and resolved start times for the clip currently loaded. */
      const timingRef = useRef(null)

      /** Place the settings card under its capsule, kept inside the viewport. */
      const openSettings = useCallback(() => {
        const viewportWidth = window.innerWidth
        const viewportHeight = window.innerHeight
        const panel = rootRef.current?.getBoundingClientRect?.()
        const width = Math.min(340, (panel?.width ?? viewportWidth) - 16, viewportWidth - 24)
        const rect = capsuleRef.current?.getBoundingClientRect?.()
        const right = rect === undefined || rect === null ? viewportWidth - 12 : rect.right
        const bottom = rect === undefined || rect === null ? 56 : rect.bottom
        const left = Math.max(12, Math.min(right - width, viewportWidth - width - 12))
        const top = Math.min(bottom + 6, Math.max(12, viewportHeight - 160))
        setSheetPlace({ left, top, width })
        setSettingsOpen(true)
      }, [])

      /** Ask the host whether it holds a Collins key; never carry the key here. */
      const loadCollinsState = useCallback(async () => {
        try {
          const response = await fetch(DICT_KEY, { cache: 'no-store' })
          if (!response.ok) return
          const payload = await response.json();
          setCollinsReady(payload.hasKey === true);
        } catch { /* the settings simply show it as missing */ }
      }, [])

      /** Hand one key to the host and forget it here. */
      const saveCollinsKey = useCallback(async () => {
        const key = collinsDraft.trim();
        if (key === '') return;
        try {
          const response = await fetch(DICT_KEY, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ key }),
          });
          const payload = await response.json().catch(() => ({}));
          setCollinsReady(payload.hasKey === true);
          setCollinsSaved(true);
          setCollinsDraft('');
        } catch { /* the row keeps saying it is missing */ }
      }, [collinsDraft])

      /** Resolve one word through one source; the answer is cached, not stored in the entry. */
      const resolveSource = useCallback(async (word, source, modelRoute) => {
        const modelKey = source === 'model' ? `${modelRoute?.provider ?? translateRoute}/${modelRoute?.model ?? ''}` : '';
        const key = `${String(word).toLowerCase()}|${source}${modelKey === '' ? '' : `|${modelKey}`}`;
        const cached = aiEntries[key];
        if (cached !== undefined) return cached;
        if (source === 'model') {
          const response = await fetch(DICT_AI, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ word, model: modelRoute ?? translateModel ?? undefined }),
          });
          const payload = await response.json().catch(() => ({}));
          if (payload.ok !== true) throw new Error(payload.error ?? t('dict.failed'));
          const built = {
            word: payload.entry.word,
            phonetic: payload.entry.phonetic,
            senses: payload.entry.senses.map((sense) => ({ pos: sense.pos, def: sense.def, example: sense.example })),
            translation: payload.entry.senses.filter((sense) => sense.zh !== '').map((sense) => ({ pos: sense.pos, def: sense.zh })),
            source: 'model',
          };
          setAiEntries((current) => ({ ...current, [key]: built }));
          return built;
        }
        const response = await fetch(`${DICT_PATH}?word=${encodeURIComponent(word)}&source=${source}`, { cache: 'no-store' });
        const payload = await response.json().catch(() => ({ ok: false }));
        if (payload.ok !== true) {
          if (payload.code === 'notFound') return null;
          throw new Error(payload.error ?? t('dict.failed'));
        }
        const built = {
          word,
          phonetic: payload.en?.phonetic ?? '',
          senses: payload.en?.senses ?? [],
          translation: payload.zh?.senses ?? [],
          source,
        };
        setAiEntries((current) => ({ ...current, [key]: built }));
        return built;
      }, [translateRoute, translateModel, aiEntries, t])

      /** Resolve a word through both slots, sharing a request when they agree. */
      const resolveWord = useCallback(async (word) => {
        const wantsChinese = dictShow !== 'en';
        const wantsEnglish = dictShow !== 'zh';
        const slots = [];
        if (wantsEnglish) slots.push({ source: dictEn, route: dictModelEn });
        if (wantsChinese) slots.push({ source: dictCn, route: dictModelCn });
        const wanted = slots.map((slot) => slot.source);
        if (wanted.length === 0) return null;
        const parts = await Promise.all(slots.map((slot) => resolveSource(word, slot.source, slot.route)));
        const chinese = wantsChinese ? (parts[wanted.indexOf(dictCn)]?.translation ?? []) : [];
        const english = wantsEnglish ? (parts[wanted.indexOf(dictEn)]?.senses ?? []) : [];
        if (chinese.length === 0 && english.length === 0) return null;
        const phonetic = parts.map((part) => part?.phonetic ?? '').find((value) => value !== '') ?? '';
        return { word, phonetic, senses: english, translation: chinese, source: `${dictEn}+${dictCn}` };
      }, [dictShow, dictCn, dictEn, dictModelCn, dictModelEn, resolveSource])

      /** Fetch (or reuse) the entry the expansion should show right now. */
      const loadWordEntry = useCallback(async (word) => {
        setOpenLoading(true)
        try {
          const entry = await resolveWord(word)
          setCardEntry(entry);
          setCardState(entry === null ? 'missing' : 'ready');
        } catch {
          setCardState('failed');
        } finally {
          setOpenLoading(false)
        }
      }, [resolveWord])

      useEffect(() => { if (settingsOpen) void loadCollinsState() }, [settingsOpen, loadCollinsState])

      // A slot that asks for a model needs that provider's list, fetched once.
      useEffect(() => {
        if (!settingsOpen || !['model'].includes(dictCn) && !['model'].includes(dictEn)) return
        for (const slot of [dictCn === 'model' ? dictModelCn : null, dictEn === 'model' ? dictModelEn : null]) {
          const provider = slot?.provider ?? translateRoute
          if (provider === '' || modelsByProvider[provider] !== undefined) continue
          void fetch(`${TRANSLATE_MODELS}?provider=${encodeURIComponent(provider)}`, { cache: 'no-store' })
            .then((response) => (response.ok ? response.json() : null))
            .then((payload) => {
              const list = Array.isArray(payload?.models) ? payload.models : [];
              setModelsByProvider((current) => ({ ...current, [provider]: list }));
            })
            .catch(() => {});
        }
      }, [settingsOpen, dictCn, dictEn, dictModelCn, dictModelEn, translateRoute, modelsByProvider])

      // The open entry belongs to whichever dictionary is selected now.
      useEffect(() => {
        if (openWordId === '') return
        const row = words.find((item) => item.id === openWordId)
        if (row !== undefined) void loadWordEntry(row.word)
      }, [dictShow, dictCn, dictEn, loadWordEntry])

      // The card belongs to the document on screen; leaving that document closes it.
      useEffect(() => { setSettingsOpen(false) }, [view, activeId])

      const active = items.find((item) => item.id === activeId) ?? null
      const activeMode = active?.mode ?? 'auto'
      const doc = useMemo(() => parseDialogue(active?.text ?? '', activeMode), [active?.text, activeMode])
      const sentences = doc.sentences
      const total = sentences.length
      const draftDoc = useMemo(() => (view === 'editor' ? parseDialogue(draft, draftMode) : doc), [view, draft, draftMode, doc])
      // Edge is built in, and the bundled model joins the list as soon as it is
      // present on disk. Everything else is a source the user added.
      // `cached` means downloaded but not loaded into the worker yet; that is
      // still installed from the user's point of view.
      const modelReady = model !== null && model.installed === true
        && (model.phase === 'ready' || model.phase === 'cached')
      const modelLoaded = model !== null && model.phase === 'ready'
      const textHash = useMemo(() => hashText(active?.text ?? ''), [active?.text])
      const storedTranslation = active?.translation
      // A translation belongs to one exact text; editing the dialogue retires it.
      // A translation belongs to one exact text AND one exact split: changing the
      // reading mode re-splits the sentences, so the old lines no longer line up.
      const translation = storedTranslation !== undefined && storedTranslation !== null
        && storedTranslation.hash === textHash
        && Array.isArray(storedTranslation.lines)
        && storedTranslation.lines.length === total
        ? storedTranslation : null
      const modelBusy = model !== null && (model.phase === 'downloading' || model.phase === 'loading')


      const sources = useMemo(() => [
        { id: 'edge', kind: 'edge', name: t('source.edge.short'), short: t('provider.edge') },
        ...(modelReady || modelBusy
          ? [{
            id: 'bundled',
            kind: 'local',
            name: t('source.local.titled'),
            short: t('source.local.model'),
            modelPath: '',
            bundledName: t('source.local.model'),
            bundled: true,
            voiceA: LOCAL_VOICES[0]?.id ?? '',
            voiceB: LOCAL_VOICES[3]?.id ?? LOCAL_VOICES[0]?.id ?? '',
          }]
          : []),
        ...extraSources.filter((entry) => entry.kind === 'local'),
        ...apiSources.map((entry) => ({
          id: `api:${entry.id}`,
          kind: 'api',
          name: entry.name,
          baseUrl: entry.baseUrl,
          model: entry.model,
          customVoices: entry.customVoices,
          short: entry.name,
          protocol: entry.protocol,
          hostId: entry.id,
          voiceA: entry.voiceA,
          voiceB: entry.voiceB,
        })),
      ], [extraSources, apiSources, localeId, modelReady, modelBusy])
      const activeSource = sources.find((entry) => entry.id === activeSourceId) ?? sources[0]
      /** The value the host understands: api sources are sent as `custom`. */
      const provider = activeSource.kind === 'api' ? 'custom' : activeSource.kind

      const voices = provider === 'local' ? LOCAL_VOICES : provider === 'custom' ? [] : EDGE_VOICES
      const voiceOf = (slot) => {
        if (activeSource.kind === 'edge') return slot === 0 ? edgeA : edgeB
        const stored = slot === 0 ? activeSource.voiceA : activeSource.voiceB
        if (typeof stored === 'string' && stored !== '') return stored
        return provider === 'local' ? (LOCAL_VOICES[0]?.id ?? '') : ''
      }
      const voiceA = voiceOf(0)
      const voiceB = voiceOf(1)
      const setVoice = (slot, value) => {
        if (activeSource.kind === 'edge') {
          if (slot === 0) setEdgeA(value)
          else setEdgeB(value)
          return
        }
        const field = slot === 0 ? 'voiceA' : 'voiceB'
        if (activeSource.kind === 'api') {
          // Endpoint sources live on the host, so the edit is written back there.
          const hostId = activeSource.hostId
          setApiSources((current) => current.map((entry) => (entry.id === hostId ? { ...entry, [field]: value } : entry)))
          void fetch(SPEECH_SOURCE_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              id: hostId,
              name: activeSource.name,
              protocol: activeSource.protocol,
              baseUrl: activeSource.baseUrl,
              model: activeSource.model,
              [field]: value,
            }),
          }).catch(() => { /* the next refresh restores the stored value */ })
          return
        }
        setExtraSources((current) => current.map((entry) => (entry.id === activeSource.id
          ? { ...entry, [field]: value }
          : entry)))
      }
      const setVoiceA = (value) => setVoice(0, value)
      const setVoiceB = (value) => setVoice(1, value)

      useLayoutEffect(() => {
        stateRef.current = {
          index, sentences, voiceA, voiceB, provider, rate, loop, autoNext, status,
          sourceId: activeSource.hostId ?? '',
          baseUrl: activeSource.baseUrl ?? '',
          model: activeSource.model ?? '',
          modelPath: activeSource.modelPath ?? '',
        }
      })

      /** Read the local provider's state. */
      const refreshModel = useCallback(async () => {
        try {
          const response = await fetch(LOCAL_STATUS, { cache: 'no-store' })
          if (!response.ok) return
          const status = await response.json()
          setModel(status)
          if (typeof status?.dir === 'string' && status.dir !== '') setModelDir(status.dir)
        } catch { /* the panel still works with Edge */ }
      }, [])

      useEffect(() => { void refreshModel() }, [refreshModel])

      /** Read the endpoint sources the host keeps. */
      const refreshApiSources = useCallback(async () => {
        try {
          const response = await fetch(SPEECH_SOURCE_PATH, { cache: 'no-store' })
          if (!response.ok) return
          const payload = await response.json()
          setApiSources(Array.isArray(payload?.sources) ? payload.sources : [])
        } catch { /* the list simply stays as it was */ }
      }, [])

      useEffect(() => { void refreshApiSources() }, [refreshApiSources])


      useEffect(() => {
        let cancelled = false
        void (async () => {
          try {
            const response = await fetch(TRANSLATE_OPTIONS, { cache: 'no-store' })
            if (!response.ok) return
            const data = await response.json()
            if (cancelled) return
            setTranslateOptions(data)
            if (Array.isArray(data.routes)) setRoutes(data.routes)
            setTranslateRoute((current) => (current === '' ? (data.model?.provider ?? '') : current))
            setTranslateModel((current) => current ?? data.model ?? null)
          } catch { /* the picker stays unavailable */ }
        })()
        return () => { cancelled = true }
      }, [])

      // The models of the chosen provider route, refetched whenever that changes.
      useEffect(() => {
        if (translateSource !== 'dsh' || translateRoute === '') return undefined
        let cancelled = false
        void (async () => {
          try {
            const response = await fetch(`${TRANSLATE_MODELS}?provider=${encodeURIComponent(translateRoute)}`, { cache: 'no-store' })
            if (!response.ok) return
            const data = await response.json()
            if (cancelled || !Array.isArray(data.models) || data.models.length === 0) return
            setModelChoices(data.models)
            // Keep the current model when it is still offered, otherwise take the
            // Harness default for this provider, otherwise the first one.
            setTranslateModel((current) => {
              const keep = current !== null && current.provider === translateRoute
                && data.models.some((entry) => entry.model === current.model)
              if (keep) return current
              const preferred = translateOptions?.model
              const useDefault = preferred !== null && preferred !== undefined && preferred.provider === translateRoute
                && data.models.some((entry) => entry.model === preferred.model)
              return { provider: translateRoute, model: useDefault ? preferred.model : data.models[0].model }
            })
          } catch { /* keep the configured default */ }
        })()
        return () => { cancelled = true }
      }, [translateSource, translateRoute, translateOptions])

      // Poll while the model is being fetched or loaded.
      useEffect(() => {
        if (provider !== 'local' || !modelBusy) return undefined
        const timer = setInterval(() => { void refreshModel() }, 800)
        return () => clearInterval(timer)
      }, [provider, modelBusy, refreshModel])

      useEffect(() => {
        if (!modelReady) return
        setErrorKind((current) => (current === 'preparing' || current === 'notInstalled' ? '' : current))
      }, [modelReady])

      const installModel = useCallback(async () => {
        try {
          await fetch(LOCAL_INSTALL, { method: 'POST' })
        } catch { /* the status poll reports the failure */ }
        setModel((current) => (current === null ? current : { ...current, phase: 'downloading', installed: true }))
        void refreshModel()
      }, [refreshModel])

      const voiceFor = useCallback((sentence) => {
        const live = stateRef.current
        return sentence !== undefined && sentence.slot === 1 ? live.voiceB : live.voiceA
      }, [])

      /** Read any text out loud in the A voice, without touching the reader. */
      const speak = useCallback(async (text, key) => {
        const live = stateRef.current
        const clean = String(text ?? '').trim()
        if (clean === '' || typeof Audio !== 'function') return
        try {
          if (sayRef.current !== null) {
            sayRef.current.pause()
            sayRef.current = null
          }
          if (sayingKey === key) { setSayingKey(''); return }
          const query = live.provider === 'custom'
            ? `provider=custom&voice=${encodeURIComponent(live.voiceA)}`
              + `&sourceId=${encodeURIComponent(live.sourceId)}&text=${encodeURIComponent(clean)}`
            : live.provider === 'local'
              ? `provider=local&voice=${encodeURIComponent(live.voiceA)}`
                + `${live.modelPath === '' ? '' : `&modelPath=${encodeURIComponent(live.modelPath)}`}`
                + `&text=${encodeURIComponent(clean)}`
              : `provider=edge&voice=${encodeURIComponent(live.voiceA)}&text=${encodeURIComponent(clean)}`
          setSayingKey(key)
          const response = await fetch(`${TTS_PATH}?${query}`)
          if (!response.ok) { setSayingKey(''); return }
          const blob = await response.blob()
          const url = URL.createObjectURL(blob)
          const audio = new Audio(url)
          audio.playbackRate = live.rate
          audio.onended = () => { setSayingKey(''); URL.revokeObjectURL(url) }
          audio.onerror = () => { setSayingKey(''); URL.revokeObjectURL(url) }
          sayRef.current = audio
          void audio.play()
        } catch {
          setSayingKey('')
        }
      }, [sayingKey])

      /** Fetch (or reuse) the clip for one sentence. */
      const clipFor = useCallback(async (sentence) => {
        const live = stateRef.current
        const voice = voiceFor(sentence)
        const key = `${live.provider}|${voice}|${sentence.text}`
        const cached = cacheRef.current.get(key)
        if (cached !== undefined) return cached
        const pending = inflightRef.current.get(key)
        if (pending !== undefined) return pending
        const query = live.provider === 'custom'
          ? `provider=custom&voice=${encodeURIComponent(voice)}`
            + `&sourceId=${encodeURIComponent(live.sourceId)}`
            + `&text=${encodeURIComponent(sentence.text)}`
          : live.provider === 'local'
            ? `provider=local&voice=${encodeURIComponent(voice)}`
              + `${live.modelPath === '' ? '' : `&modelPath=${encodeURIComponent(live.modelPath)}`}`
              + `&text=${encodeURIComponent(sentence.text)}`
            : `provider=edge&voice=${encodeURIComponent(voice)}&text=${encodeURIComponent(sentence.text)}`
        const request = fetch(`${TTS_PATH}?${query}`)
          .then(async (response) => {
            if (!response.ok) {
              if (response.status === 503) {
                const body = await response.json().catch(() => ({}))
                const failure = new Error(body.code ?? 'not-installed')
                failure.name = body.code === 'preparing' ? 'PreparingError' : 'NotInstalledError'
                throw failure
              }
              const failure = new Error(`HTTP ${response.status}`)
              failure.status = response.status
              throw failure
            }
            const marks = decodeMarks(response.headers.get('x-er-marks'))
            const blob = await response.blob()
            const url = URL.createObjectURL(blob)
            if (disposedRef.current) {
              URL.revokeObjectURL(url)
              throw new Error('panel closed')
            }
            const clip = { url, marks }
            cacheRef.current.set(key, clip)
            return clip
          })
          .catch((failure) => {
            if (failure instanceof TypeError) {
              const offline = new Error(failure.message)
              offline.name = 'NetworkError'
              throw offline
            }
            throw failure
          })
          .finally(() => { inflightRef.current.delete(key) })
        inflightRef.current.set(key, request)
        return request
      }, [voiceFor])

      /** Warm the clips just after the one playing. */
      const prefetch = useCallback((from) => {
        const list = stateRef.current.sentences
        for (let offset = 1; offset <= PREFETCH; offset += 1) {
          const sentence = list[from + offset]
          if (sentence === undefined) return
          void clipFor(sentence).catch(() => { /* retried on arrival */ })
        }
      }, [clipFor])

      /** Light exactly one rendered word, touching the DOM directly so the list never re-renders. */
      const applyWord = useCallback((position) => {
        if (activeWordRef.current === position) return
        const spans = wordRefs.current
        const previous = spans[activeWordRef.current]
        if (previous !== undefined && previous !== null) previous.classList.remove('er-w-on')
        const next = spans[position]
        if (next !== undefined && next !== null) next.classList.add('er-w-on')
        activeWordRef.current = position
      }, [])

      /** Speak one sentence and keep the position in sync with it. */
      const playAt = useCallback(async (target) => {
        const list = stateRef.current.sentences
        if (list.length === 0) return
        const next = Math.max(0, Math.min(target, list.length - 1))
        audioRef.current?.pause()
        setIndex(next)
        stateRef.current.index = next
        setNoticeKey('')
        const token = (tokenRef.current += 1)
        setStatus('loading')
        setErrorKind('')
        if (stateRef.current.provider === 'local') void refreshModel()
        try {
          const clip = await clipFor(list[next])
          if (token !== tokenRef.current) return
          const audio = audioRef.current
          if (audio === null) return
          // Arm word tracking before playback so the first frame has a table.
          timingRef.current = {
            words: wordsOf(list[next].text),
            marks: clip.marks ?? [],
            times: null,
          }
          applyWord(-1)
          audio.src = clip.url
          audio.playbackRate = stateRef.current.rate
          await audio.play()
          if (token !== tokenRef.current) return
          setStatus('playing')
          prefetch(next)
        } catch (failure) {
          if (token !== tokenRef.current) return
          if (failure instanceof Error && failure.name === 'NotAllowedError') {
            setStatus('idle')
            setNoticeKey('autoplay')
            return
          }
          if (failure instanceof Error && failure.name === 'NotInstalledError') {
            setStatus('idle')
            setErrorKind('notInstalled')
            void refreshModel()
            return
          }
          if (failure instanceof Error && failure.name === 'PreparingError') {
            setStatus('idle')
            setErrorKind('preparing')
            void refreshModel()
            return
          }
          const name = failure instanceof Error ? failure.name : ''
          const code = failure?.status
          setErrorKind(name === 'NetworkError' ? 'network'
            : code === 413 ? 'tooLong'
              : code === 502 || code === 500 ? 'server'
                : 'generic')
          setStatus('error')
        }
      }, [clipFor, prefetch, refreshModel])

      const toggle = useCallback(() => {
        const audio = audioRef.current
        if (audio === null) return
        const live = stateRef.current
        if (live.status === 'playing') {
          audio.pause()
          setStatus('paused')
          return
        }
        if (live.status === 'paused' && audio.src !== '') {
          audio.playbackRate = live.rate
          void audio.play().then(() => setStatus('playing')).catch(() => { void playAt(live.index) })
          return
        }
        void playAt(live.status === 'done' ? 0 : live.index)
      }, [playAt])

      const step = useCallback((delta) => { void playAt(stateRef.current.index + delta) }, [playAt])

      // The audio element is mounted for the panel's whole life, so these
      // listeners stay attached across view switches.
      useEffect(() => {
        const audio = audioRef.current
        if (audio === null) return undefined
        const onEnded = () => {
          const live = stateRef.current
          if (live.loop) { void playAt(live.index); return }
          // Continuous playback is a choice: with it off a sentence ends and stops.
          if (live.autoNext === false) { setStatus('done'); setNoticeKey('stopped'); return }
          if (live.index + 1 < live.sentences.length) { void playAt(live.index + 1); return }
          setStatus('done')
        }
        const onError = () => { setErrorKind('generic'); setStatus('error') }
        audio.addEventListener('ended', onEnded)
        audio.addEventListener('error', onError)
        return () => {
          audio.removeEventListener('ended', onEnded)
          audio.removeEventListener('error', onError)
        }
      }, [playAt])

      useEffect(() => {
        if (audioRef.current !== null) audioRef.current.playbackRate = rate
      }, [rate])

      // Word highlight follows the media clock, so rate changes and seeks keep it true.
      useEffect(() => {
        if (status !== 'playing') return undefined
        const audio = audioRef.current
        if (audio === null) return undefined
        let frame = 0
        const tick = () => {
          const timing = timingRef.current
          if (timing !== null && timing.words.length > 0) {
            if (timing.times === null) {
              const known = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 : 0
              timing.times = buildTimings(timing.words, timing.marks, known)
            }
            const now = audio.currentTime * 1000
            let active = -1
            for (let position = 0; position < timing.times.length; position += 1) {
              if (timing.times[position] <= now + 24) active = position
              else break
            }
            applyWord(active)
          }
          frame = requestAnimationFrame(tick)
        }
        frame = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(frame)
      }, [status, index, applyWord])

      /** Write the library out; overrides let a handler persist a state React has not rendered yet. */
      const persist = useCallback((override) => {
        const list = override?.items ?? items
        const id = override?.activeId === undefined ? activeId : override.activeId
        const at = override?.index === undefined ? index : override.index
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
            version: 3, activeId: id, sources: extraSources, activeSourceId, edgeA, edgeB, rate, loop, autoNext, columnWidth, fontScale, customPct, customPx,
            showTranslation, translateSource, translateModel, autoNext, words, dictShow, dictCn, dictEn, aiEntries, dictModelCn, dictModelEn,
            items: list.map((item) => (item.id === id ? { ...item, index: at } : item)),
          }))
        } catch { /* storage full or blocked: the panel still works */ }
      }, [items, activeId, index, extraSources, activeSourceId, edgeA, edgeB, rate, loop, autoNext, showTranslation, translateSource, translateModel, columnWidth, fontScale, customPct, customPx, words, dictShow, dictCn, dictEn, aiEntries, dictModelCn, dictModelEn])

      // Remember the library, the position, and the settings.
      useEffect(() => {
        const write = () => persist()
        saveRef.current = write
        const timer = setTimeout(write, 350)
        return () => { clearTimeout(timer) }
      }, [persist])

      useEffect(() => () => {
        disposedRef.current = true
        saveRef.current?.()
        for (const clip of cacheRef.current.values()) URL.revokeObjectURL(clip.url)
        cacheRef.current.clear()
        inflightRef.current.clear()
      }, [])

      useEffect(() => {
        const box = listRef.current
        const row = rowRefs.current[index]
        if (box === null || row === undefined || row === null) return
        box.scrollTo({ top: Math.max(0, row.offsetTop - box.clientHeight / 2 + row.clientHeight / 2), behavior: 'smooth' })
      }, [index, view, activeId])

      /**
       * Abandon whatever the player is doing: invalidate the in-flight sentence,
       * drop the loaded clip (it belongs to the engine and time it was fetched
       * for), and return the transport to idle.
       */
      const cancelPlayback = useCallback(() => {
        tokenRef.current += 1
        const audio = audioRef.current
        if (audio !== null) {
          audio.pause()
          audio.removeAttribute('src')
          audio.load?.()
        }
        setStatus('idle')
      }, [])

      /** Translate every sentence of the open dialogue in one request. */
      const translateActive = useCallback(async () => {
        if (translating || sentences.length === 0) return
        setTranslating(true)
        setTranslateError('')
        try {
          const response = await fetch(TRANSLATE_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              source: translateSource,
              target: translateOptions?.target ?? 'zh-CN',
              model: translateModel ?? undefined,
              texts: sentences.map((sentence) => sentence.text),
            }),
          })
          const data = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${response.status}`)
          const lines = Array.isArray(data.translations) ? data.translations : []
          if (lines.length !== sentences.length) throw new Error('the translation came back incomplete')
          setItems((current) => current.map((item) => (item.id === activeId
            ? {
              ...item,
              translation: {
                hash: hashText(item.text),
                source: translateSource,
                model: translateModel,
                target: typeof data.target === 'string' ? data.target : 'zh-CN',
                lines,
              },
            }
            : item)))
        } catch (error) {
          setTranslateError(error instanceof Error ? error.message : String(error))
        } finally {
          setTranslating(false)
        }
      }, [translating, sentences, activeId, translateSource, translateModel, translateOptions])

      /** Show or hide the translation, fetching it the first time it is asked for. */
      const toggleTranslation = useCallback(() => {
        if (showTranslation) { setShowTranslation(false); return }
        setShowTranslation(true)
        if (translation === null) void translateActive()
      }, [showTranslation, translation, translateActive])

      // Translation was switched on, this dialogue has none yet, and the previous
      // attempt did not fail: fetch it once for the dialogue that is open.
      useEffect(() => {
        if (!showTranslation || translating || translateError !== '') return
        if (view !== 'reader' || total === 0 || translation !== null) return
        if (translateOptions === null) return
        void translateActive()
      }, [showTranslation, translating, translateError, view, total, translation, translateOptions, translateActive])


      /** Enter the editor for a brand-new dialogue. */
      const newDialogue = useCallback(() => {
        saveRef.current?.()
        cancelPlayback()
        setDraft('')
        setDraftMode('auto')
        setEditingId(null)
        setView('editor')
        requestAnimationFrame(() => { rootRef.current?.querySelector('textarea')?.focus() })
      }, [cancelPlayback])

      /** Enter the editor for the active dialogue. */
      const editActive = useCallback(() => {
        saveRef.current?.()
        cancelPlayback()
        setDraft(active?.text ?? '')
        setDraftMode(active?.mode ?? 'auto')
        setEditingId(active?.id ?? null)
        setView('editor')
        requestAnimationFrame(() => { rootRef.current?.querySelector('textarea')?.focus() })
      }, [active, cancelPlayback])

      /** Open one dialogue's text in the editor without reading it first. */
      const editItem = useCallback((item) => {
        saveRef.current?.()
        cancelPlayback()
        setActiveId(item.id)
        setDraft(item.text ?? '')
        setDraftMode(item.mode ?? 'auto')
        setEditingId(item.id)
        setView('editor')
        requestAnimationFrame(() => { rootRef.current?.querySelector('textarea')?.focus() })
      }, [cancelPlayback])

      const cancelEditor = useCallback(() => {
        // A draft that was never saved has no dialogue to go back to, so the
        // library is where the user came from.
        setView(editingId === null || active === null ? 'library' : 'reader')
        requestAnimationFrame(() => { rootRef.current?.focus() })
      }, [active, editingId])

      /** Save the draft into the library and start reading it. */
      const startReading = useCallback(() => {
        const raw = draft
        if (raw.trim() === '') return
        const parsed = parseDialogue(raw, draftMode)
        if (parsed.sentences.length === 0) return
        const existing = editingId === null ? null : items.find((item) => item.id === editingId) ?? null
        const sameText = existing !== null && existing.text === raw
        const id = existing?.id ?? makeId()
        const carry = sameText && Number.isInteger(existing?.index)
          ? Math.min(existing.index, parsed.sentences.length - 1)
          : 0
        const next = existing === null
          ? [{ id, title: titleFor(raw) || t('untitled'), text: raw, mode: draftMode, index: carry, createdAt: Date.now(), updatedAt: Date.now() }, ...items]
          : items.map((item) => (item.id === id
            ? { ...item, text: raw, mode: draftMode, title: titleFor(raw) || item.title, index: carry, updatedAt: Date.now() }
            : item))
        setItems(next.slice(0, LIBRARY_LIMIT))
        setActiveId(id)
        setIndex(carry)
        setView('reader')
        setNoticeKey(sameText && carry > 0 ? 'resumed' : '')
        stateRef.current.sentences = parsed.sentences
        stateRef.current.index = carry
        requestAnimationFrame(() => { rootRef.current?.focus() })
        void playAt(carry)
      }, [draft, draftMode, editingId, items, playAt, t])

      /** Open a stored dialogue at the sentence it was left on. */
      const openItem = useCallback((id) => {
        // Flush first: the debounced save would otherwise write this dialogue's
        // position against the library entry that is about to become inactive.
        saveRef.current?.()
        cancelPlayback()
        const item = items.find((candidate) => candidate.id === id)
        if (item === undefined) return
        const parsed = parseDialogue(item.text, item.mode)
        const carry = Number.isInteger(item.index) ? Math.max(0, Math.min(item.index, parsed.sentences.length - 1)) : 0
        setActiveId(id)
        setIndex(carry)
        setStatus('idle')
        setNoticeKey(carry > 0 ? 'resumed' : '')
        setView('reader')
        stateRef.current.sentences = parsed.sentences
        stateRef.current.index = carry
      }, [items, cancelPlayback])

      const removeItem = useCallback((id) => {
        setConfirmDelete('')
        const next = items.filter((item) => item.id !== id)
        if (id !== activeId) {
          setItems(next)
          persist({ items: next })
          return
        }
        cancelPlayback()
        const fallback = next[0] ?? null
        // The position belongs to the fallback's own text, which may be shorter.
        const count = fallback === null ? 0 : parseDialogue(fallback.text, fallback.mode).sentences.length
        const stored = Number.isInteger(fallback?.index) ? fallback.index : 0
        const at = Math.max(0, Math.min(stored, Math.max(0, count - 1)))
        persist({ items: next, activeId: fallback?.id ?? '', index: at })
        setItems(next)
        setActiveId(fallback?.id ?? '')
        setIndex(at)
        setDraft('')
        setEditingId(null)
        // Stay wherever the delete was pressed. Only an empty library has
        // nothing left to show, and it falls back to the paste box.
        if (fallback === null) setView('editor')
        else if (view === 'editor') setView('reader')
        setNoticeKey('')
      }, [items, activeId, cancelPlayback, persist, view])

      /** Add a source the user configured, then make it the active one. */
      /** Open the dialog on an existing source; the key stays blank on purpose. */
      const openSourceEditor = useCallback((entry) => {
        setEditingSource(entry.id)
        setAddKind(entry.kind === 'local' ? 'local' : 'api')
        setDraftId(entry.hostId ?? '')
        setDraftName(entry.name ?? '')
        setDraftBaseUrl(entry.baseUrl ?? '')
        setDraftModel(entry.model ?? '')
        setDraftProtocol(entry.protocol ?? 'auto')
        setDraftPath(entry.modelPath ?? '')
        setDraftKey('')
        setAddError('')
        setProbe({ state: 'idle', message: '' })
        setAddOpen(true)
      }, [])

      /** Close the dialog and forget the draft it was holding. */
      const closeAdd = useCallback(() => {
        setAddOpen(false)
        setEditingSource('')
        setAddError('')
        setDraftId('')
        setDraftName('')
        setDraftBaseUrl('')
        setDraftModel('')
        setDraftPath('')
        setDraftKey('')
        setApiModels([])
        setProbe({ state: 'idle', message: '' })
      }, [])

      const addSource = useCallback(async () => {
        if (validating) return
        const baseUrl = draftBaseUrl.trim().replace(/\/$/, '')
        const path = draftPath.trim().replace(/\/+$/, '')
        setAddError('')
        setValidating(true)
        try {
          if (addKind === 'local') {
            if (path === '') { setAddError(t('add.err.needFolder')); return }
            if (editingSource !== '') {
              const verdict = await (await fetch(VALIDATE, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ kind: 'local', modelPath: path }),
              })).json().catch(() => ({ ok: false, code: 'unknown' }))
              if (verdict.ok !== true) { setAddError(reasonOf(verdict)); return }
              setExtraSources((current) => current.map((entry) => (entry.id === editingSource
                ? {
                  ...entry,
                  name: draftName.trim() !== '' ? draftName.trim() : entry.name,
                  modelPath: path,
                }
                : entry)))
              closeAdd()
              return
            }
            if (extraSources.some((entry) => entry.kind === 'local' && entry.modelPath === path)) {
              setAddError(t('add.err.duplicate'))
              return
            }
            const verdict = await (await fetch(VALIDATE, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ kind: 'local', modelPath: path }),
            })).json().catch(() => ({ ok: false, code: 'unknown' }))
            if (verdict.ok !== true) { setAddError(reasonOf(verdict)); return }
            const id = `s${Date.now().toString(36)}`
            setExtraSources((current) => [...current, {
              id,
              kind: 'local',
              name: draftName.trim() !== '' ? draftName.trim() : t('source.local.short'),
              modelPath: path,
              voiceA: LOCAL_VOICES[0]?.id ?? '',
              voiceB: LOCAL_VOICES[3]?.id ?? LOCAL_VOICES[0]?.id ?? '',
            }])
            cancelPlayback()
            setActiveSourceId(id)
            closeAdd()
            return
          }
          // An endpoint source: checked, then stored on the host.
          const id = editingSource !== '' ? editingSource.slice(4) : draftId.trim().toLowerCase()
          if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) { setAddError(t('add.err.badId')); return }
          if (baseUrl === '') { setAddError(t('add.err.needUrl')); return }
          if (editingSource === '' && apiSources.some((entry) => entry.id === id)) {
            setAddError(t('add.err.duplicate'))
            return
          }
          const verdict = await (await fetch(VALIDATE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              kind: 'api',
              protocol: draftProtocol,
              baseUrl,
              model: draftModel.trim(),
              key: draftKey,
              voice: '',
              // While editing, the stored key stands in for the untyped one.
              sourceId: editingSource === '' ? '' : editingSource.slice(4),
            }),
          })).json().catch(() => ({ ok: false, code: 'unknown' }))
          if (verdict.ok !== true) { setAddError(reasonOf(verdict)); return }
          const saved = await (await fetch(SPEECH_SOURCE_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            // No key means "keep the stored one": the panel never reads it back.
            body: JSON.stringify({
              id,
              name: draftName.trim() !== '' ? draftName.trim() : id,
              protocol: draftProtocol,
              baseUrl,
              model: draftModel.trim(),
              ...(draftKey === '' ? {} : { key: draftKey }),
            }),
          })).json().catch(() => ({ ok: false, code: 'unknown' }))
          if (saved.ok !== true) { setAddError(reasonOf(saved)); return }
          await refreshApiSources()
          cancelPlayback()
          setActiveSourceId(`api:${id}`)
          closeAdd()
        } catch {
          setAddError(t('add.err.network'))
        } finally {
          setValidating(false)
        }
      }, [addKind, draftId, draftName, draftBaseUrl, draftModel, draftPath, draftKey, draftProtocol, editingSource,
        extraSources, apiSources, validating, refreshApiSources, cancelPlayback, closeAdd, t])

      /** Rename an endpoint on the host, or a local folder here. */
      const renameSource = useCallback(async (id, value) => {
        const name = value.trim()
        setRenamingSource('')
        if (id === '' || name === '') return
        if (id.startsWith('api:')) {
          try {
            await fetch(SPEECH_SOURCE_PATH, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ id: id.slice(4), name }),
            })
          } catch { /* the old name stays */ }
          await refreshApiSources()
          return
        }
        setExtraSources((current) => current.map((entry) => (entry.id === id ? { ...entry, name } : entry)))
      }, [refreshApiSources])

      /** Rename or pin a saved dialogue. */
      const renameItem = useCallback((id, value) => {
        const title = value.trim()
        setRenamingItem('')
        if (id === '' || title === '') return
        const next = items.map((entry) => (entry.id === id ? { ...entry, title } : entry))
        setItems(next)
        persist({ items: next })
      }, [items, persist])

      const togglePin = useCallback((id) => {
        const next = items.map((entry) => (entry.id === id ? { ...entry, pinned: entry.pinned !== true } : entry))
        setItems(next)
        persist({ items: next })
      }, [items, persist])

      /** Drop an added source; Edge and the bundled model cannot be removed. */
      const removeSource = useCallback(async (id) => {
        cancelPlayback()
        if (id.startsWith('api:')) {
          try {
            await fetch(`${SPEECH_SOURCE_PATH}?id=${encodeURIComponent(id.slice(4))}`, { method: 'DELETE' })
          } catch { /* the list simply refreshes without it */ }
          await refreshApiSources()
        } else {
          setExtraSources((current) => current.filter((entry) => entry.id !== id))
        }
        if (activeSourceId === id) setActiveSourceId('edge')
      }, [activeSourceId, cancelPlayback, refreshApiSources])

      // Closing forgets the whole attempt — fields, refusal and probe — so the
      // next visit starts from a blank form whatever closed it.
      useEffect(() => {
        if (addOpen) return
        setAddError('')
        setDraftId('')
        setDraftName('')
        setDraftBaseUrl('')
        setDraftModel('')
        setDraftPath('')
        setDraftKey('')
        setApiModels([])
        setProbe({ state: 'idle', message: '' })
      }, [addOpen])
      useEffect(() => {
        setAddError('')
        setApiModels([])
        setProbe({ state: 'idle', message: '' })
      }, [addKind])

      // A download started from the add dialog joins the list and becomes active.
      useEffect(() => {
        if (!awaitBundled) return
        if (modelReady) {
          setAwaitBundled(false)
          setActiveSourceId('bundled')
          setAddOpen(false)
          return
        }
        if (model !== null && model.phase === 'error') setAwaitBundled(false)
      }, [awaitBundled, modelReady, model])

      /** Translate a refusal from the host into something readable. */
      const reasonOf = (verdict) => {
        const reason = typeof verdict?.code === 'string' && verdict.code !== ''
          ? t(`add.err.${verdict.code}`)
          : String(verdict?.error ?? t('add.err.unknown'))
        const detail = typeof verdict?.detail === 'string' && verdict.detail !== ''
          ? ` (${verdict.detail.slice(0, 120)})`
          : ''
        return `${reason}${detail}`
      }

      // Geometry follows the transcript handles DSH ships: the strip sits outside the
      // column and the column keeps a safe margin from the pane edge, so a drag can
      // never collapse it onto the frame.
      // Width presets, and the sizes a reader actually picks between.
      const WIDTH_STEPS = [
        { id: 'narrow', px: 600 },
        { id: 'mid', px: 760 },
        { id: 'wide', px: 920 },
      ]
      /** No preset chosen yet still needs a measure: the widest one. */
      const DEFAULT_WIDTH = 920
      const FONT_STEPS = [{ id: 's', scale: 0.9 }, { id: 'm', scale: 1 }, { id: 'l', scale: 1.15 }]
      const COLUMN_MIN = 320
      const EDGE_BUDGET = 176
      // A preset wider than the pane fills it; "full" always does.
      const preferredWidth = customPct > 0
        ? (panelWidth * customPct) / 100
        : (columnWidth === 0 ? DEFAULT_WIDTH : columnWidth)
      const columnActual = Math.min(Math.max(200, preferredWidth), Math.max(200, panelWidth - 16))
      /** The reading measure, shared by the reader and both list pages. */
      const pageBox = { width: `${Math.round(columnActual)}px`, maxWidth: '100%', margin: '0 auto' }
      // The reading text is 14px at scale 1, so a typed size converts by division.
      const effectiveScale = customPx > 0 ? customPx / 14 : fontScale

      /** Follow the panel's own width, so the clamp tracks the layout. */
      useEffect(() => {
        const node = rootRef.current
        if (node === null || typeof ResizeObserver !== 'function') return undefined
        const measure = () => {
          const rect = node.getBoundingClientRect()
          setPanelWidth(rect.width)
          setPanelHeight(rect.height)
        }
        const observer = new ResizeObserver(measure)
        observer.observe(node)
        measure()
        return () => observer.disconnect()
      }, [])

      /** Unused drag handler kept out of the tree; the measure moves by slider. */
      const startResize = useCallback((side) => (event) => {
        event.preventDefault()
        const strip = event.currentTarget
        const column = strip.parentElement?.querySelector('.er-column')
        const startWidth = column === null || column === undefined
          ? COLUMN_MIN
          : column.getBoundingClientRect().width
        const startX = event.clientX
        if (typeof strip.setPointerCapture === 'function') strip.setPointerCapture(event.pointerId)
        const move = (moveEvent) => {
          const travelled = moveEvent.clientX - startX
          const outward = side === 'right' ? travelled : -travelled
          const next = Math.round(startWidth + outward * 2)
          setColumnWidth(Math.min(Math.max(next, COLUMN_MIN), Math.max(COLUMN_MIN, panelWidth - EDGE_BUDGET)))
        }
        const stop = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', stop)
          document.body.style.cursor = ''
        }
        document.body.style.cursor = 'col-resize'
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', stop)
      }, [panelWidth])

      /** Fetch one word for the card: both slots resolve, translation only as a last resort. */
      const lookUp = useCallback(async (raw) => {
        const word = String(raw).trim();
        if (word === '') return;
        setCardState('loading');
        setCardError('');
        setCardEntry(null);
        try {
          const entry = await resolveWord(word);
          if (entry !== null) { setCardEntry(entry); setCardState('ready'); return; }
        } catch (error) {
          setCardState('failed');
          setCardError(error instanceof Error ? error.message : t('dict.failed'));
          return;
        }
        // Neither slot has an entry: a plain translation is still worth showing.
        try {
          const response = await fetch(TRANSLATE_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              source: translateSource,
              target: translateOptions?.target ?? 'zh-CN',
              model: translateModel ?? undefined,
              texts: [word],
            }),
          });
          const payload = await response.json().catch(() => ({}));
          const translated = Array.isArray(payload?.translations) ? payload.translations[0] : '';
          if (typeof translated === 'string' && translated !== '') {
            setCardEntry({ word, phonetic: '', senses: [], translation: [{ pos: '', def: translated }], source: 'translate' });
            setCardState('ready');
            return;
          }
          setCardState('missing');
        } catch {
          setCardState('failed');
          setCardError(t('dict.failed'));
        }
      }, [resolveWord, translateSource, translateOptions, translateModel, t])

      const openPinnedWord = useCallback((raw) => {
        const word = String(raw).trim();
        if (word === '') return;
        setQuery(word);
        setCard({ word, x: 0, y: 0, pinned: true });
        void lookUp(word);
      }, [lookUp])

      const openWordCard = useCallback((raw, x, y) => {
        const word = String(raw).trim();
        if (word === '') return;
        setCard({ word, x, y, pinned: false });
        void lookUp(word);
      }, [lookUp])

      /** Keep one entry in the word list, newest first, deduplicated. */
      const saveWord = useCallback((entry) => {
        if (entry === null) return;
        const id = String(entry.word).toLowerCase().replace(/[^a-z' -]/g, '').trim();
        if (id === '') return;
        // Only the word and the sentence it came from are kept: definitions come
        // from the dictionary or the cache, so switching source changes what the
        // entry shows instead of freezing one answer.
        const sentence = card !== null && card.pinned === true
          ? ''
          : stateRef.current.sentences[stateRef.current.index]?.text ?? '';
        setWords((current) => {
          const rest = current.filter((item) => item.id !== id);
          return [{ word: entry.word, id, context: sentence, addedAt: Date.now() }, ...rest].slice(0, 500);
        });
      }, [card])

      /** Ask the host which voices this endpoint can offer. */
      const loadVoices = useCallback(async () => {
        if (activeSource.kind !== 'api') return
        setLoadingVoices(true)
        try {
          const query = `baseUrl=${encodeURIComponent(activeSource.baseUrl ?? '')}`
            + `&protocol=${encodeURIComponent(activeSource.protocol ?? 'auto')}`
            + `&sourceId=${encodeURIComponent(activeSource.hostId ?? '')}`
          const response = await fetch(`${VOICES}?${query}`, { cache: 'no-store' })
          const payload = await response.json().catch(() => ({ voices: [] }))
          setVoiceChoices(Array.isArray(payload?.voices) ? payload.voices : [])
          setVoicesListed(payload?.listed === true)
        } catch { /* suggestions are optional */ } finally {
          setLoadingVoices(false)
        }
      }, [activeSource.kind, activeSource.baseUrl, activeSource.protocol])

      useEffect(() => {
        setVoiceChoices([])
        setVoicesListed(false)
        if (settingsOpen && activeSource.kind === 'api') void loadVoices()
      }, [settingsOpen, activeSource.id, activeSource.kind, loadVoices])

      /** Keep a voice on this source, so it is offered next time without retyping. */
      const rememberVoice = useCallback(async () => {
        if (activeSource.kind !== 'api') return
        const typed = voiceA.trim()
        if (typed === '') { setAddError(''); return }
        const existing = Array.isArray(activeSource.customVoices) ? activeSource.customVoices : []
        if (existing.includes(typed)) return
        try {
          await fetch(SPEECH_SOURCE_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              id: activeSource.hostId,
              name: activeSource.name,
              protocol: activeSource.protocol,
              baseUrl: activeSource.baseUrl,
              model: activeSource.model,
              customVoices: [...existing, typed],
            }),
          })
        } catch { /* the field still holds the value */ }
        await refreshApiSources()
        await loadVoices()
      }, [activeSource, voiceA, refreshApiSources, loadVoices])

      /** Ask the endpoint which models it offers. */
      const fetchModels = useCallback(async () => {
        const baseUrl = draftBaseUrl.trim().replace(/\/$/, '')
        if (baseUrl === '') { setAddError(t('add.err.needUrl')); return }
        setFetchingModels(true)
        setProbe({ state: 'idle', message: '' })
        try {
          const query = `baseUrl=${encodeURIComponent(baseUrl)}&protocol=${encodeURIComponent(draftProtocol)}`
            + `&key=${encodeURIComponent(draftKey)}`
            + `&sourceId=${encodeURIComponent(editingSource === '' ? '' : editingSource.slice(4))}`
          const response = await fetch(`${MODELS}?${query}`, { cache: 'no-store' })
          const verdict = await response.json().catch(() => ({ ok: false, code: 'unknown' }))
          if (verdict.ok !== true) { setAddError(reasonOf(verdict)); return }
          const list = Array.isArray(verdict.models) ? verdict.models : []
          setApiModels(list)
          if (list.length === 0) { setAddError(t('add.err.noModels')); return }
          setAddError('')
          if (draftModel.trim() === '' && list[0]?.id !== undefined) setDraftModel(list[0].id)
        } catch {
          setAddError(t('add.err.network'))
        } finally {
          setFetchingModels(false)
        }
      }, [draftBaseUrl, draftModel, draftKey, draftProtocol, editingSource, t])

      /** Prove the endpoint answers, without adding anything. */
      const testEndpoint = useCallback(async () => {
        const baseUrl = draftBaseUrl.trim().replace(/\/$/, '')
        if (baseUrl === '') { setAddError(t('add.err.needUrl')); return }
        setValidating(true)
        setProbe({ state: 'idle', message: '' })
        try {
          const response = await fetch(VALIDATE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              kind: 'api',
              protocol: draftProtocol,
              baseUrl,
              model: draftModel.trim(),
              key: draftKey,
              voice: '',
            }),
          })
          const verdict = await response.json().catch(() => ({ ok: false, code: 'unknown' }))
          setProbe(verdict.ok === true
            ? { state: 'ok', message: t('add.testOk') }
            : { state: 'bad', message: `${reasonOf(verdict)} · ${t(`add.keyUsed.${verdict.keySource ?? 'none'}`)}` })
        } catch {
          setProbe({ state: 'bad', message: t('add.err.network') })
        } finally {
          setValidating(false)
        }
      }, [draftBaseUrl, draftModel, draftKey, draftProtocol, editingSource, t])

      /** Ask the host for a directory, so a model on disk can be used as-is. */
      const pickModelDir = useCallback(async () => {
        try {
          const chosen = await pickDirectory()
          if (typeof chosen === 'string' && chosen !== '') setDraftPath(chosen)
        } catch { /* the dialog was dismissed */ }
      }, [pickDirectory])

      const switchSource = useCallback((next) => {
        if (next === activeSourceId) return
        saveRef.current?.()
        cancelPlayback()
        setActiveSourceId(next)
        setErrorKind('')
      }, [activeSourceId, cancelPlayback])

      const onKeyDown = useCallback((event) => {
        if (event.key === 'Escape' && card !== null) {
          event.preventDefault()
          setCard(null)
          return
        }
        if (event.key === 'Escape' && addOpen) {
          event.preventDefault()
          setAddOpen(false)
          return
        }
        if (event.key === 'Escape' && settingsOpen) {
          event.preventDefault()
          setSettingsOpen(false)
          return
        }
        if (view !== 'reader') return
        const tag = event.target?.tagName ?? ''
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return
        if (event.key === ' ') {
          if (tag === 'BUTTON') return
          event.preventDefault()
          toggle()
          return
        }
        if (event.key === 'ArrowLeft') { event.preventDefault(); if (stateRef.current.index > 0) step(-1); return }
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          if (stateRef.current.index + 1 < stateRef.current.sentences.length) step(1)
        }
      }, [view, step, toggle, settingsOpen, addOpen, card])

      const voiceLabel = (slot) => voices.find((voice) => voice.id === (slot === 1 ? voiceB : voiceA))?.label ?? ''

      /** The provider switch plus the local model's state. */
      // ---------------------------------------------------------------- header
      // The capsule names whatever source is actually active. Treating every
      // non-local source as Edge was wrong as soon as endpoints existed.
      // The capsule names the model actually in use, not just its family.
      const engineLabel = activeSource.short ?? activeSource.name
      const canGoBack = (view === 'words' || view === 'library') && returnView.current !== 'editor'
      const headerTitle = view === 'words' ? t('words.title')
        : view === 'library' ? t('library.title') : (active?.title ?? t('tab.title'))
      const headerMeta = view === 'library'
        ? fill(t('library.count'), { n: items.length })
        : view === 'editor'
          ? ''
          : (doc.mode === 'dialogue' ? t('mode.dialogue') : t('mode.article'))

      // On a sub-page the row under the title is the way back, not a label
      // that repeats what the tab already says.
      const headerNote = canGoBack
        ? h('button', {
          type: 'button', className: 'er-back-row',
          onClick: () => goView('reader'),
        }, h('span', { className: 'er-back-arrow', 'aria-hidden': true }, '\u2190'), h('span', null, t('backRow')))
        : headerMeta === '' ? null : h('div', { className: 'er-meta' }, headerMeta)

      const header = h('div', { className: 'er-head' },
        h('div', { className: 'er-head-text' },
          h('div', { className: 'er-title' }, headerTitle),
          headerNote),
        view !== 'reader' ? null : h('button', {
          type: 'button',
          className: `er-glyph${showTranslation ? ' er-glyph-on' : ''}`,
          title: showTranslation ? t('trans.hide') : t('trans.show'),
          'aria-label': showTranslation ? t('trans.hide') : t('trans.show'),
          'aria-pressed': showTranslation ? 'true' : 'false',
          disabled: total === 0 || translating,
          onClick: toggleTranslation,
        }, translating ? h('span', { className: 'er-spin' }) : glyph(ICON.translate, 16)),
        view !== 'reader' ? null : h('button', {
          type: 'button', className: 'er-glyph', title: t('header.edit'), 'aria-label': t('header.edit'),
          onClick: editActive,
        }, glyph(ICON.edit, 16)),
        view === 'editor' ? null : h('button', {
          type: 'button',
          className: `er-glyph${view === 'library' ? ' er-glyph-on' : ''}`,
          title: t('header.library'), 'aria-label': t('header.library'),
          'aria-pressed': view === 'library' ? 'true' : 'false',
          onClick: () => goView(view === 'library' ? returnView.current : 'library'),
        }, glyph(ICON.library, 16)),
        h('button', {
          type: 'button', className: `er-glyph${view === 'words' ? ' er-glyph-on' : ''}`,
          title: t('words.title'), 'aria-label': t('words.title'),
          onClick: () => goView(view === 'words' ? returnView.current : 'words'),
        }, glyphLine(ICON.book, 16)),
        h('button', {
          type: 'button',
          className: `er-capsule${modelBusy ? ' er-capsule-busy' : ''}`,
          title: t('settings.title'),
          ref: capsuleRef,
          'aria-haspopup': 'dialog',
          'aria-expanded': settingsOpen ? 'true' : 'false',
          onClick: () => (settingsOpen ? setSettingsOpen(false) : openSettings()),
        },
          modelBusy ? h('span', { className: 'er-dot er-dot-run', 'aria-hidden': true }) : null,
          h('span', { className: 'er-capsule-text' }, engineLabel),
          glyph(ICON.caret, 13)))

      // --------------------------------------------------------------- library
      const library = h('div', { className: 'er-scroll er-index-wrap', style: pageBox },
        items.length === 0
          ? h('p', { className: 'er-empty' }, t('library.empty'))
          : h('ul', { className: 'er-index' }, [...items]
            .sort((left, right) => (Number(right.pinned === true) - Number(left.pinned === true))
              || (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
            .map((item) => {
            const parsed = parseDialogue(item.text, item.mode)
            const count = parsed.sentences.length
            const at = Number.isInteger(item.index) ? Math.min(item.index, Math.max(0, count - 1)) : 0
            return h('li', { key: item.id, className: `er-entry${item.id === activeId ? ' er-entry-on' : ''}` },
              renamingItem === item.id
                ? h('div', { className: 'er-entry-open' },
                  h('input', {
                    className: 'er-input', value: nameDraft, autoFocus: true, spellCheck: false,
                    'aria-label': t('renamePrompt'),
                    onChange: (event) => setNameDraft(event.target.value),
                    onKeyDown: (event) => {
                      if (event.key === 'Enter') { event.preventDefault(); renameItem(item.id, nameDraft) }
                      if (event.key === 'Escape') { event.preventDefault(); setRenamingItem('') }
                    },
                    onBlur: () => renameItem(item.id, nameDraft),
                  }))
                : h('button', { type: 'button', className: 'er-entry-open', onClick: () => openItem(item.id) },
                  h('span', { className: 'er-entry-title' },
                    item.pinned === true ? h('span', { className: 'er-entry-pin', 'aria-hidden': true }, glyph(ICON.pin, 11)) : null,
                    item.title || t('untitled')),
                  h('span', { className: 'er-entry-meta' }, fill(t('library.position'), { n: at + 1, m: count }))),
              h('button', {
                type: 'button', className: `er-entry-act${item.pinned === true ? ' er-entry-act-on' : ''}`,
                title: item.pinned === true ? t('unpin') : t('pin'),
                'aria-label': item.pinned === true ? t('unpin') : t('pin'),
                onClick: () => togglePin(item.id),
              }, glyph(ICON.pin, 12)),
              h('button', {
                type: 'button', className: 'er-entry-act', title: t('library.edit'), 'aria-label': t('library.edit'),
                onClick: () => editItem(item),
              }, glyph(ICON.edit, 12)),
              h('button', {
                type: 'button', className: 'er-entry-act', title: t('rename'), 'aria-label': t('rename'),
                onClick: () => { setNameDraft(item.title ?? ''); setRenamingItem(item.id) },
              }, glyph(ICON.rename, 12)),
              h('button', {
                type: 'button',
                className: `er-entry-del${confirmDelete === item.id ? ' er-entry-del-on' : ''}`,
                title: t('delete'), 'aria-label': t('delete'),
                onClick: () => { if (confirmDelete === item.id) removeItem(item.id); else setConfirmDelete(item.id) },
              }, confirmDelete === item.id ? t('deleteConfirm') : glyph(ICON.close, 13)))
          })),
        h('div', { className: 'er-index-foot' },
          h('button', { type: 'button', className: 'er-cta', onClick: newDialogue }, t('library.new'))))

      // ---------------------------------------------------------------- editor
      const visibleWords = words.filter((item) => {
        const needle = wordFilter.trim().toLowerCase()
        if (needle === '') return true
        const zh = sensesOf(item.translation).map((sense) => sense.def).join(' ')
        return String(item.word).toLowerCase().includes(needle)
          || sensesOf(item.senses).some((sense) => sense.def.toLowerCase().includes(needle))
          || zh.toLowerCase().includes(needle)
      })

      /** Open one saved word in place, resolving it through the current dictionary. */
      const toggleWord = (item) => {
        if (openWordId === item.id) { setOpenWordId(''); setOpenLoading(false); return }
        setOpenWordId(item.id)
        setCardState('idle')
        void loadWordEntry(item.word)
      }


      const wordsPage = h('div', { className: 'er-scroll er-words', style: pageBox },
        h('div', { className: 'er-words-bar' },
          h('input', {
            className: 'er-input', value: wordFilter, spellCheck: false,
            placeholder: t('words.filter'), 'aria-label': t('words.filter'),
            onChange: (event) => setWordFilter(event.target.value),
          })),
        words.length === 0
          ? h('p', { className: 'er-empty' }, t('words.empty'))
          : visibleWords.length === 0
            ? h('p', { className: 'er-empty' }, t('words.none'))
            : h('ul', { className: 'er-index' }, visibleWords.map((item) => {
              const open = openWordId === item.id
              const resolved = open && cardEntry !== null && String(cardEntry.word).toLowerCase() === String(item.word).toLowerCase()
                ? cardEntry : null
              const chinese = resolved === null || dictShow === 'en' ? [] : sensesOf(resolved.translation)
              const english = resolved === null || dictShow === 'zh' ? [] : sensesOf(resolved.senses)
              const unsupported = open && resolved !== null && chinese.length === 0 && english.length === 0
              const hasContext = typeof item.context === 'string' && item.context.trim() !== ''
              const cachedCn = aiEntries[`${String(item.word).toLowerCase()}|${dictCn}`]
              const cachedEn = aiEntries[`${String(item.word).toLowerCase()}|${dictEn}`]
              const gloss = (sensesOf(cachedCn?.translation)[0]?.def ?? sensesOf(cachedCn?.senses)[0]?.def
                ?? sensesOf(cachedEn?.senses)[0]?.def ?? sensesOf(cachedEn?.translation)[0]?.def ?? '')
              return h('li', { key: item.id, className: `er-wrow${open ? ' er-wrow-on' : ''}` },
                h('div', { className: 'er-wrow-head' },
                  h('button', {
                    type: 'button', className: 'er-entry-open', 'aria-expanded': open ? 'true' : 'false',
                    onClick: () => toggleWord(item),
                  },
                    h('span', { className: 'er-entry-title' }, item.word),
                    h('span', { className: 'er-entry-meta' }, gloss === '' ? t('words.noGloss') : gloss)),
                  h('button', {
                    type: 'button',
                    className: `er-entry-act${sayingKey === `w:${item.id}` ? ' er-entry-act-on' : ''}`,
                    title: t('words.say'), 'aria-label': t('words.say'),
                    onClick: () => { void speak(item.word, `w:${item.id}`) },
                  }, glyph(ICON.speaker, 13)),
                  h('button', {
                    type: 'button', className: 'er-entry-act',
                    title: t('words.lookup'), 'aria-label': t('words.lookup'),
                    onClick: () => { setOpenWordId(''); openPinnedWord(item.word) },
                  }, glyphLine(ICON.book, 14)),
                  h('button', {
                    type: 'button', className: 'er-entry-del', title: t('words.remove'), 'aria-label': t('words.remove'),
                    onClick: () => setWords((current) => current.filter((entry) => entry.id !== item.id)),
                  }, glyph(ICON.close, 13))),
                open
                  ? h('div', { className: 'er-wrow-body' },
                    openLoading
                      ? h('p', { className: 'er-wordcard-note' }, t('dict.loading'))
                      : resolved === null
                        ? h('p', { className: 'er-wordcard-note' }, t('dict.missing'))
                        : unsupported
                          ? h('p', { className: 'er-wordcard-note' }, t('words.emptyEntry'))
                          : null,
                    chinese.length > 0
                      ? h('div', { className: 'er-wrow-zh' }, chinese.map((sense, at) => h('div', {
                        key: at, className: 'er-wordcard-trline',
                      },
                        sense.pos === '' ? null : h('span', { className: 'er-sense-pos' }, sense.pos),
                        h('span', null, sense.def))))
                      : null,
                    english.length > 0
                      ? h('div', { className: 'er-wrow-en' }, english.map((sense, at) => h('div', { key: at, className: 'er-sense' },
                        h('div', { className: 'er-sense-line' },
                          sense.pos === '' ? null : h('span', { className: 'er-sense-pos' }, sense.pos),
                          h('span', null, sense.def)),
                        sense.example === ''
                          ? null
                          : h('div', { className: 'er-sense-eg' },
                            h('span', null, sense.example),
                            h('button', {
                              type: 'button',
                              className: `er-say${sayingKey === `e:${item.id}:${at}` ? ' er-say-on' : ''}`,
                              title: t('words.sayExample'), 'aria-label': t('words.sayExample'),
                              onClick: () => { void speak(sense.example, `e:${item.id}:${at}`) },
                            }, glyph(ICON.speaker, 12))))))
                      : null,
                    h('p', { className: 'er-wrow-ctx' },
                      h('span', { className: 'er-wrow-ctx-label' }, t('words.context')),
                      h('span', { className: 'er-wrow-ctx-text' }, hasContext ? item.context : t('words.noContext')),
                      h('button', {
                        type: 'button',
                        className: `er-say er-say-ctx${sayingKey === `s:${item.id}` ? ' er-say-on' : ''}`,
                        title: t('words.sayContext'), 'aria-label': t('words.sayContext'),
                        disabled: !hasContext,
                        onClick: () => { void speak(item.context, `s:${item.id}`) },
                      }, glyph(ICON.speaker, 12))))
                  : null)
            })))

      const editor = h('div', { className: 'er-editor' },
        h('textarea', {
          className: 'er-textarea',
          value: draft,
          spellCheck: false,
          'aria-label': t('empty.hint'),
          placeholder: t('empty.placeholder'),
          onChange: (event) => setDraft(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); startReading() }
          },
        }),
        h('p', { className: 'er-hint' }, t(draftDoc.mode === 'dialogue' ? 'mode.hint.dialogue' : 'mode.hint.article')),
        h('div', { className: 'er-editor-bar' },
          h('label', { className: 'er-inline' },
            h('span', { className: 'er-inline-label' }, t('mode.label')),
            h('select', {
              className: 'er-plain-select', value: draftMode,
              onChange: (event) => setDraftMode(event.target.value),
            }, [
              ['auto', t('mode.auto')],
              ['article', t('mode.article')],
              ['dialogue', t('mode.dialogue')],
            ].map(([value, label]) => h('option', { key: value, value }, label)))),
          h('span', { className: 'er-grow' }),
          h('button', { type: 'button', className: 'er-cta er-cta-quiet', onClick: () => setDraft(SAMPLE) }, t('empty.sample')),
          h('button', { type: 'button', className: 'er-cta er-cta-quiet', onClick: cancelEditor }, t('cancel')),
          h('button', {
            type: 'button', className: 'er-cta er-cta-strong',
            disabled: draft.trim() === '',
            onClick: startReading,
          }, editingId === null ? t('start') : t('save'))))

      // --------------------------------------------------------------- reading
      /**
       * Only the sentence on screen becomes word spans; every other sentence stays
       * one text node, so a 200-sentence article never pays for the highlight.
       */
      const renderLine = (sentence, position) => {
        if (position !== index) return sentence.text
        const parts = sentence.text.split(/(\s+)/)
        let counter = 0
        return parts.map((part, key) => {
          if (part === '' || /^\s+$/.test(part)) return part
          const slot = counter
          counter += 1
          return h('span', {
            key,
            className: 'er-w',
            ref: (node) => { wordRefs.current[slot] = node },
            title: t('dict.hint'),
            onContextMenu: (event) => {
              event.preventDefault()
              const rect = rootRef.current?.getBoundingClientRect?.()
              openWordCard(part, event.clientX - (rect?.left ?? 0), event.clientY - (rect?.top ?? 0))
            },
          }, part)
        })
      }

      const showing = showTranslation && translation !== null
      const list = h('div', { className: 'er-body-wrap' },
        h('div', { className: 'er-scroll er-read', ref: listRef },
        total === 0
          ? h('p', { className: 'er-empty' }, t('empty.text'))
          : h('div', {
            className: 'er-column',
            style: { width: `${Math.round(columnActual)}px` },
          }, sentences.map((sentence, position) => {
            const dialogue = doc.mode === 'dialogue'
            const previous = position === 0 ? null : sentences[position - 1]
            const showMark = dialogue && (previous === null
              || previous.speaker !== sentence.speaker
              || previous.slot !== sentence.slot)
            const newParagraph = previous !== null && previous.paragraph !== sentence.paragraph
            const name = sentence.speaker ?? (sentence.slot === 1 ? 'B' : 'A')
            const translated = showing ? translation.lines[position] : undefined
            return h('button', {
              key: `${position}-${sentence.text.slice(0, 12)}`,
              type: 'button',
              ref: (node) => { rowRefs.current[position] = node },
              'aria-current': position === index ? 'true' : undefined,
              className: `er-passage${position === index ? ' er-passage-on' : ''}${position !== index ? ' er-dim' : ''}${newParagraph ? ' er-passage-para' : ''}`,
              title: dialogue ? `${name} · ${voiceLabel(sentence.slot)}` : undefined,
              onClick: () => {
                if ((window.getSelection()?.toString() ?? '') !== '') return
                void playAt(position)
              },
            },
              dialogue && showMark
                ? h('span', { className: 'er-mark', 'aria-hidden': true }, name.length <= 2 ? name : name.slice(0, 1))
                : dialogue ? h('span', { className: 'er-mark', 'aria-hidden': true }) : null,
              h('span', { className: 'er-body' },
                h('span', { className: 'er-line', lang: 'en' }, renderLine(sentence, position)),
                translated === undefined || translated === ''
                  ? null
                  : h('span', { className: 'er-trans', lang: translation?.target ?? 'zh-CN' }, translated)))
          }))))

      const statusText = translating ? t('trans.working')
        : status === 'loading' ? t('loading')
          : total === 0 ? ''
            : `${index + 1} / ${total}`

      const notice = status === 'done' ? t('done')
        : status === 'paused' ? t('paused')
          : noticeKey === 'stopped' ? t('stopped')
            : noticeKey === 'resumed' ? t('resumed', { n: index + 1 })
              : noticeKey === 'autoplay' ? t('autoplay') : ''

      const transport = h('div', { className: 'er-transport' },
        h('button', {
          type: 'button', className: 'er-glyph', 'aria-label': t('prev'), title: t('prev'),
          disabled: index === 0, onClick: () => step(-1),
        }, glyph(ICON.prev, 16)),
        h('button', {
          type: 'button', className: 'er-play',
          'aria-label': status === 'playing' ? t('pause') : t('play'),
          title: status === 'playing' ? t('pause') : t('play'),
          'aria-busy': status === 'loading' ? 'true' : undefined,
          disabled: status === 'loading' || total === 0,
          onClick: toggle,
        }, status === 'loading' ? h('span', { className: 'er-spin' }) : glyph(status === 'playing' ? ICON.pause : ICON.play, 17)),
        h('button', {
          type: 'button', className: 'er-glyph', 'aria-label': t('next'), title: t('next'),
          disabled: index + 1 >= total, onClick: () => step(1),
        }, glyph(ICON.next, 16)),
        h('button', {
          type: 'button', className: `er-glyph${loop ? ' er-glyph-on' : ''}`,
          'aria-label': t('loop'), title: t('loop'),
          role: 'switch', 'aria-checked': loop ? 'true' : 'false',
          onClick: () => setLoop((value) => !value),
        }, glyph(ICON.repeat, 16)),
        h('button', {
          type: 'button', className: `er-glyph${autoNext ? ' er-glyph-on' : ''}`,
          'aria-label': t('autoNext'), title: t('autoNext'),
          role: 'switch', 'aria-checked': autoNext ? 'true' : 'false',
          onClick: () => setAutoNext((value) => !value),
        }, glyph(ICON.chain, 16)),
        h('span', { className: 'er-grow' }),
        notice === '' ? null : h('span', { className: 'er-notice-text' }, notice),
        h('span', { className: 'er-count', role: 'status', 'aria-live': 'polite' }, statusText),
        h('select', {
          className: 'er-plain-select er-rate', value: String(rate),
          'aria-label': t('speed'), title: t('speed'),
          onChange: (event) => setRate(Number(event.target.value)),
        }, SPEEDS.map((value) => h('option', { key: value, value: String(value) }, `${value}×`))))

      // --------------------------------------------------------------- settings
      // Once the model is usable the facts already say so; this block is only the
      // in-between state (downloading, loading, or failed).
      const modelNote = model === null
        ? h('p', { className: 'er-fine' }, '…')
        : modelReady
          ? null
          : modelBusy
          ? h('div', { className: 'er-model' },
            h('div', {
              className: 'er-meter',
              role: 'progressbar',
              'aria-label': t('provider.local'),
              'aria-valuemin': '0', 'aria-valuemax': '100',
              'aria-valuenow': String(Math.round((model?.progress ?? 0) * 100)),
              'aria-valuetext': `${Math.round((model?.progress ?? 0) * 100)}%`,
            }, h('div', { className: 'er-meter-fill', style: { width: `${Math.max(3, Math.round((model?.progress ?? 0) * 100))}%` } })),
            h('p', { className: 'er-fine' }, model?.phase === 'loading'
              ? t('local.loading')
              : fill(t('local.downloading'), { n: Math.round((model?.progress ?? 0) * 100) })))
          : h('div', { className: 'er-model' },
            h('p', { className: 'er-fine' }, model?.phase === 'error'
              ? `${t('local.failed')}${model?.error === '' ? '' : `: ${String(model.error).slice(0, 60)}`}`
              : fill(t('local.desc'), { size: megabytes(model?.approximateBytes ?? model?.totalBytes) })),
            h('button', {
              type: 'button', className: 'er-cta er-cta-quiet',
              onClick: installModel,
            }, model?.phase === 'error' ? t('local.retry') : t('local.download')))

      const field = (label, control) => h('label', { className: 'er-field' },
        h('span', { className: 'er-field-label' }, label), control)

      const factRow = (label, value) => h('div', { className: 'er-fact' },
        h('span', { className: 'er-fact-label' }, label),
        h('span', { className: 'er-fact-value' }, value))

      const localState = model === null ? '…'
        : modelBusy ? (model?.phase === 'loading' ? t('local.loading') : fill(t('local.downloading'), { n: Math.round((model?.progress ?? 0) * 100) }))
          : modelReady ? (modelLoaded ? t('local.ready') : t('local.cached'))
            : model?.phase === 'error' ? t('local.failed')
              : t('local.notReady')

      const sourceBackend = provider === 'edge' ? t('engine.backend.edge')
        : provider === 'local' ? t('engine.backend.local')
          : (activeSource.model !== undefined && activeSource.model !== '' ? activeSource.model : t('source.custom'))
      const localFolder = activeSource.modelPath !== undefined && activeSource.modelPath !== ''
        ? activeSource.modelPath
        : modelDir
      const sourceLink = provider === 'edge' ? t('engine.connection.edge')
        : provider === 'local' ? (localFolder !== '' ? shortPath(localFolder) : t('engine.backend.local'))
          : (activeSource.baseUrl === undefined || activeSource.baseUrl === '' ? t('custom.noEndpoint') : activeSource.baseUrl)
      const sourceState = provider === 'edge' ? t('state.online')
        : provider === 'local' ? localState
          : (activeSource.baseUrl === undefined || activeSource.baseUrl === ''
            ? t('state.notConfigured')
            : t('state.configured'))

      /** The source rows: Edge is permanent, the rest can be removed. */
      const sourceRows = sources.map((entry) => h('li', {
        key: entry.id,
        className: `er-source${entry.id === activeSource.id ? ' er-source-on' : ''}`,
      },
        h('button', {
          type: 'button', className: 'er-source-pick',
          role: 'radio', 'aria-checked': entry.id === activeSource.id ? 'true' : 'false',
          onClick: () => { if (renamingSource !== entry.id) switchSource(entry.id) },
        },
          h('span', { className: 'er-radio', 'aria-hidden': true }),
          renamingSource === entry.id
            ? h('input', {
              className: 'er-input', value: nameDraft, autoFocus: true, spellCheck: false,
              'aria-label': t('renamePrompt'),
              onClick: (event) => event.stopPropagation(),
              onChange: (event) => setNameDraft(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') { event.preventDefault(); void renameSource(entry.id, nameDraft) }
                if (event.key === 'Escape') { event.preventDefault(); setRenamingSource('') }
              },
              onBlur: () => { void renameSource(entry.id, nameDraft) },
            })
            : h('span', { className: 'er-source-text' },
            h('span', { className: 'er-source-name' }, entry.name),
            h('span', { className: 'er-source-meta' }, entry.kind === 'edge' ? t('source.builtin')
              : entry.kind === 'local'
                ? (entry.bundled === true ? t('source.bundled') : shortPath(entry.modelPath ?? ''))
                : (entry.baseUrl ?? '')))),
        entry.kind === 'edge' || entry.bundled === true ? null : h('button', {
          type: 'button', className: 'er-source-act', title: t('editSource'), 'aria-label': t('editSource'),
          onClick: () => openSourceEditor(entry),
        }, glyph(ICON.settings, 12)),
        entry.kind === 'edge' || entry.bundled === true ? null : h('button', {
          type: 'button', className: 'er-source-del', title: t('delete'), 'aria-label': t('delete'),
          onClick: () => removeSource(entry.id),
        }, glyph(ICON.close, 12))))

      const settingsCard = settingsOpen && sheetPlace !== null ? [
        h('div', { key: 'catcher', className: 'er-catcher', onMouseDown: () => setSettingsOpen(false) }),
        h('div', {
          key: 'card',
          className: 'er-card',
          style: { left: `${sheetPlace.left}px`, top: `${sheetPlace.top}px`, width: `${sheetPlace.width}px` },
          role: 'dialog', 'aria-modal': 'true', 'aria-label': t('settings.title'),
        },
          h('div', { className: 'er-card-head' },
            h('h2', { className: 'er-card-title' }, t('settings.title')),
            h('span', { className: 'er-card-hint' }, t('settings.hint')),
            h('button', {
              type: 'button', className: 'er-glyph', 'aria-label': t('close'), title: t('close'),
              onClick: () => setSettingsOpen(false),
            }, glyph(ICON.close, 15))),
          h('div', { className: 'er-card-body' },
            h('section', { className: 'er-sect' },
              h('h3', { className: 'er-sect-title' }, t('settings.engine')),
              h('ul', { className: 'er-sources', role: 'radiogroup', 'aria-label': t('source.label') }, sourceRows),
              h('button', {
                type: 'button', className: 'er-add',
                onClick: () => { setAddKind('api'); setAddOpen(true) },
              }, glyph(ICON.plus, 13), t('source.add')),
              h('div', { className: 'er-facts' },
                factRow(t('engine.backend'), sourceBackend),
                factRow(provider === 'local' ? t('engine.folder') : t('engine.connection'), sourceLink),
                factRow(t('engine.state'), sourceState)),
              provider === 'local' ? modelNote : null),
            h('section', { className: 'er-sect' },
              h('h3', { className: 'er-sect-title' }, t('settings.voices')),
              activeSource.kind !== 'api' ? null : h('datalist', { id: 'er-voice-list' },
                voiceChoices.map((entry) => h('option', { key: entry.id, value: entry.id },
                  entry.origin === undefined || entry.origin === 'catalog'
                    ? entry.label
                    : `${entry.label} · ${t(entry.origin === 'cloned' ? 'voice.cloned'
                      : entry.origin === 'manual' ? 'voice.mine' : 'voice.fromEndpoint')}`))),
              h('div', { className: 'er-pair' },
                activeSource.kind === 'api'
                  ? field(t('voice.a'), h('input', {
                    className: 'er-input', value: voiceA, spellCheck: false, list: 'er-voice-list',
                    placeholder: voiceChoices.length > 0 ? t('voice.pick') : t('voice.manualPlaceholder'),
                    onChange: (event) => setVoiceA(event.target.value),
                  }))
                  : field(t('voice.a'), h('select', {
                    className: 'er-select', value: voiceA,
                    onChange: (event) => setVoiceA(event.target.value),
                  }, voices.map((voice) => h('option', { key: voice.id, value: voice.id }, voice.label)))),
                activeSource.kind === 'api'
                  ? field(t('voice.b'), h('input', {
                    className: 'er-input', value: voiceB, spellCheck: false, list: 'er-voice-list',
                    placeholder: voiceChoices.length > 0 ? t('voice.pick') : t('voice.manualPlaceholder'),
                    onChange: (event) => setVoiceB(event.target.value),
                  }))
                  : field(t('voice.b'), h('select', {
                    className: 'er-select', value: voiceB,
                    onChange: (event) => setVoiceB(event.target.value),
                  }, voices.map((voice) => h('option', { key: voice.id, value: voice.id }, voice.label))))),
              activeSource.kind !== 'api' ? null : h('div', { className: 'er-voice-acts' },
                h('button', {
                  type: 'button', className: 'er-add er-add-plain',
                  disabled: loadingVoices,
                  onClick: () => { void loadVoices() },
                }, loadingVoices ? t('voice.loading') : t('voice.refresh')),
                h('button', {
                  type: 'button', className: 'er-add er-add-plain',
                  disabled: voiceA.trim() === '',
                  onClick: () => { void rememberVoice() },
                }, t('voice.add'))),
              activeSource.kind !== 'api' || voicesListed || loadingVoices
                ? null
                : h('p', { className: 'er-fine' }, t('voice.manual'))),
            h('section', { className: 'er-sect' },
              h('h3', { className: 'er-sect-title' }, t('settings.dict')),
              field(t('dict.show'), h('div', { className: 'er-seg', role: 'radiogroup', 'aria-label': t('dict.show') },
                ['both', 'en', 'zh'].map((kind) => h('button', {
                  key: kind, type: 'button', role: 'radio',
                  'aria-checked': dictShow === kind ? 'true' : 'false',
                  className: 'er-seg-btn',
                  onClick: () => setDictShow(kind),
                }, t(`dict.kind.${kind}`))))),
              field(t('dict.slot.cn'), h('select', {
                className: 'er-select', value: dictCn,
                onChange: (event) => setDictCn(event.target.value),
              }, [
                ['iciba', t('dict.src.iciba')],
                ['model', t('dict.src.model')],
              ].map(([id, label]) => h('option', { key: id, value: id }, label)))),
              dictCn === 'model' ? h('div', { className: 'er-pair' },
                field(t('dict.modelProvider'), h('select', {
                  className: 'er-select', value: routeOf(dictModelCn),
                  onChange: (event) => setDictModelCn({ provider: event.target.value, model: '' }),
                }, (routes.length === 0
                  ? [{ provider: translateOptions?.model?.provider ?? '', name: translateOptions?.model?.provider ?? '—' }]
                  : routes
                ).map((entry) => h('option', { key: entry.provider, value: entry.provider }, entry.name ?? entry.provider)))),
                field(t('dict.modelName'), h('select', {
                  className: 'er-select', value: modelOf(dictModelCn),
                  onChange: (event) => setDictModelCn({ provider: routeOf(dictModelCn), model: event.target.value }),
                }, ((modelsByProvider[routeOf(dictModelCn)] ?? []).length === 0
                  ? [{ model: translateOptions?.model?.model ?? '', name: translateOptions?.model?.model ?? '—' }]
                  : modelsByProvider[routeOf(dictModelCn)]
                ).map((entry) => h('option', { key: entry.model, value: entry.model }, entry.name ?? entry.model))))) : null,
              field(t('dict.slot.en'), h('select', {
                className: 'er-select', value: dictEn,
                onChange: (event) => setDictEn(event.target.value),
              }, [
                ['wordnet', t('dict.src.wordnet')],
                ['wiktionary', t('dict.src.wiktionary')],
                ['collins', t('dict.src.collins')],
                ['model', t('dict.src.model')],
              ].map(([id, label]) => h('option', { key: id, value: id }, label)))),
              dictEn === 'model' ? h('div', { className: 'er-pair' },
                field(t('dict.modelProvider'), h('select', {
                  className: 'er-select', value: routeOf(dictModelEn),
                  onChange: (event) => setDictModelEn({ provider: event.target.value, model: '' }),
                }, (routes.length === 0
                  ? [{ provider: translateOptions?.model?.provider ?? '', name: translateOptions?.model?.provider ?? '—' }]
                  : routes
                ).map((entry) => h('option', { key: entry.provider, value: entry.provider }, entry.name ?? entry.provider)))),
                field(t('dict.modelName'), h('select', {
                  className: 'er-select', value: modelOf(dictModelEn),
                  onChange: (event) => setDictModelEn({ provider: routeOf(dictModelEn), model: event.target.value }),
                }, ((modelsByProvider[routeOf(dictModelEn)] ?? []).length === 0
                  ? [{ model: translateOptions?.model?.model ?? '', name: translateOptions?.model?.model ?? '—' }]
                  : modelsByProvider[routeOf(dictModelEn)]
                ).map((entry) => h('option', { key: entry.model, value: entry.model }, entry.name ?? entry.model))))) : null,
              !(dictCn === 'collins' || dictEn === 'collins')
                ? null
                : h('div', { className: 'er-key-row' },
                  field(t('dict.collinsKey'), h('input', {
                    className: 'er-input', type: 'password', value: collinsDraft, spellCheck: false,
                    placeholder: collinsReady ? t('dict.collinsStored') : t('dict.collinsKeyHint'),
                    onChange: (event) => { setCollinsDraft(event.target.value); setCollinsSaved(false) },
                    onKeyDown: (event) => { if (event.key === 'Enter') { event.preventDefault(); void saveCollinsKey() } },
                  })),
                  h('button', {
                    type: 'button', className: 'er-add er-add-plain',
                    disabled: collinsDraft.trim() === '',
                    onClick: () => { void saveCollinsKey() },
                  }, collinsSaved ? t('dict.saved') : t('dict.save')),
                  h('p', { className: 'er-fine' }, collinsReady ? t('dict.collinsOnHost') : t('dict.collinsMissing'))),
              h('p', { className: 'er-fine' }, t('dict.kindHint'))),
            h('section', { className: 'er-sect' },
              h('h3', { className: 'er-sect-title' }, t('trans.title')),
              h('button', {
                type: 'button', className: 'er-toggle-row',
                role: 'switch', 'aria-checked': showTranslation ? 'true' : 'false',
                disabled: total === 0,
                onClick: toggleTranslation,
              },
                h('span', null, t('trans.show')),
                h('span', { className: `er-track${showTranslation ? ' er-track-on' : ''}`, 'aria-hidden': true },
                  h('span', { className: 'er-knob' }))),
              field(t('trans.source'), h('select', {
                className: 'er-select', value: translateSource,
                onChange: (event) => setTranslateSource(event.target.value),
              }, SOURCES.map((id) => {
                const ready = translateOptions === null
                  || translateOptions.providers.some((entry) => entry.id === id && entry.ready === true)
                return h('option', { key: id, value: id, disabled: !ready },
                  `${t(`trans.${id}`)}${ready ? '' : ` — ${t('trans.unavailable')}`}`)
              }))),
              translateSource !== 'dsh' ? null : h('div', { className: 'er-pair' },
                field(t('trans.provider'), h('select', {
                  className: 'er-select', value: translateRoute,
                  onChange: (event) => setTranslateRoute(event.target.value),
                }, (routes.length === 0
                  ? [{ provider: translateOptions?.model?.provider ?? '', name: translateOptions?.model?.provider ?? '—' }]
                  : routes
                ).map((entry) => h('option', { key: entry.provider, value: entry.provider }, entry.name ?? entry.provider)))),
                field(t('trans.model'), h('select', {
                  className: 'er-select', value: translateModel?.model ?? '',
                  onChange: (event) => setTranslateModel((current) => ({
                    provider: current?.provider ?? translateRoute,
                    model: event.target.value,
                  })),
                }, (modelChoices.length === 0
                  ? [{ model: translateOptions?.model?.model ?? '', name: translateOptions?.model?.model ?? '—' }]
                  : modelChoices
                ).map((entry) => h('option', { key: entry.model, value: entry.model }, entry.name ?? entry.model))))),
              translateError === '' ? null : h('p', { className: 'er-fine er-fine-err' }, `${t('trans.failed')}: ${translateError.slice(0, 120)}`)),
            h('div', { className: 'er-card-foot' },
              h('button', {
                type: 'button', className: 'er-cta er-cta-quiet',
                disabled: total === 0,
                onClick: () => { void playAt(0); setSettingsOpen(false) },
              }, t('restart'))))),
      ] : null

      const addDialog = addOpen ? [
        h('div', { key: 'veil', className: 'er-veil', onMouseDown: () => setAddOpen(false) }),
        h('div', {
          key: 'dialog',
          className: 'er-dialog',
          role: 'dialog', 'aria-modal': 'true', 'aria-label': t('add.title'),
        },
          h('div', { className: 'er-dialog-head' },
            h('h2', { className: 'er-dialog-title' }, editingSource === '' ? t('add.title') : t('add.editTitle')),
            h('button', {
              type: 'button', className: 'er-glyph', 'aria-label': t('close'), title: t('close'),
              onClick: () => setAddOpen(false),
            }, glyph(ICON.close, 15))),
          h('div', { className: 'er-dialog-body' },
            editingSource !== '' ? null : h('div', { className: 'er-seg', role: 'radiogroup', 'aria-label': t('add.title') },
              h('button', {
                type: 'button', role: 'radio', 'aria-checked': addKind === 'api' ? 'true' : 'false',
                className: 'er-seg-btn', onClick: () => setAddKind('api'),
              }, t('add.kind.api')),
              h('button', {
                type: 'button', role: 'radio', 'aria-checked': addKind === 'local' ? 'true' : 'false',
                className: 'er-seg-btn', onClick: () => setAddKind('local'),
              }, t('add.kind.local'))),
            addKind === 'api'
              ? h('div', null,
                field(t('add.id'), h('input', {
                  className: 'er-input', value: draftId, spellCheck: false, disabled: editingSource !== '',
                  placeholder: 'my-tts',
                  onChange: (event) => setDraftId(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')),
                })),
                h('p', { className: 'er-fine er-fine-dim' }, t('add.id.hint')),
                field(t('add.name'), h('input', {
                  className: 'er-input', value: draftName, spellCheck: false,
                  placeholder: t('source.custom'),
                  onChange: (event) => setDraftName(event.target.value),
                })),
                field(t('add.protocol'), h('select', {
                  className: 'er-select', value: draftProtocol,
                  onChange: (event) => {
                    setDraftProtocol(event.target.value)
                    setApiModels([])
                    setProbe({ state: 'idle', message: '' })
                  },
                }, [
                  ['auto', t('add.protocol.auto')],
                  ['openai', t('add.protocol.openai')],
                  ['dashscope', t('add.protocol.dashscope')],
                  ['azure', t('add.protocol.azure')],
                ]
                  .map(([value, label]) => h('option', { key: value, value }, label)))),
                field(t('custom.baseUrl'), h('input', {
                  className: 'er-input', value: draftBaseUrl, spellCheck: false,
                  placeholder: draftProtocol === 'azure'
                    ? 'https://<region>.tts.speech.microsoft.com/cognitiveservices/v1'
                    : draftProtocol === 'dashscope'
                      ? 'https://dashscope.aliyuncs.com'
                      : 'https://api.example.com/v1',
                  onChange: (event) => { setDraftBaseUrl(event.target.value); setProbe({ state: 'idle', message: '' }) },
                })),
                field(t('add.key'), h('input', {
                  className: 'er-input', type: 'password', value: draftKey, spellCheck: false,
                  placeholder: editingSource === '' ? t('add.key.placeholder') : t('custom.keyKeep'),
                  onChange: (event) => { setDraftKey(event.target.value); setProbe({ state: 'idle', message: '' }) },
                })),
                // Connectivity needs the endpoint and the key together, so the test
                // rides the hint's line, right-aligned and small.
                h('div', { className: 'er-keyline' },
                  h('span', { className: 'er-fine er-fine-dim' }, t('add.key.hint')),
                  h('button', {
                    type: 'button', className: 'er-bundled-act',
                    disabled: validating || draftBaseUrl.trim() === '',
                    onClick: () => { void testEndpoint() },
                  }, validating ? t('add.testing') : t('add.test'))),
                probe.state === 'ok' ? h('p', { className: 'er-fine er-probe-ok', role: 'status' }, probe.message) : null,
                probe.state === 'bad' ? h('p', { className: 'er-fine er-fine-err', role: 'status' }, probe.message) : null,
                field(t('custom.model'), h('div', { className: 'er-dir' },
                  apiModels.length === 0
                    ? h('input', {
                      className: 'er-input', value: draftModel, spellCheck: false,
                      placeholder: t('add.modelPlaceholder'),
                      onChange: (event) => setDraftModel(event.target.value),
                    })
                    : h('select', {
                      className: 'er-select', value: draftModel,
                      onChange: (event) => setDraftModel(event.target.value),
                    }, apiModels.map((entry) => h('option', { key: entry.id, value: entry.id }, entry.name))),
                  h('button', {
                    type: 'button', className: 'er-cta er-cta-quiet',
                    disabled: fetchingModels || draftProtocol === 'azure',
                    onClick: () => { void fetchModels() },
                  }, fetchingModels ? t('add.fetching') : t('add.fetchModels')))))

              : h('div', null,
                field(t('add.name'), h('input', {
                  className: 'er-input', value: draftName, spellCheck: false,
                  placeholder: t('source.local.short'),
                  onChange: (event) => setDraftName(event.target.value),
                })),
                field(t('add.dir'), h('div', { className: 'er-dir' },
                  h('input', {
                    className: 'er-input', value: draftPath, spellCheck: false,
                    placeholder: t('add.dir.placeholder'),
                    onChange: (event) => setDraftPath(event.target.value),
                  }),
                  h('button', {
                    type: 'button', className: 'er-cta er-cta-quiet',
                    onClick: () => { void pickModelDir() },
                  }, t('add.pick')))),
                h('p', { className: 'er-fine' }, t('add.dir.hint')),
                // The bundled model is the fallback, so it sits under the folder
                // field: one compact line with a state dot and its action.
                h('div', { className: 'er-bundled' },
                  h('span', {
                    className: `er-dot ${modelReady ? 'er-dot-ok' : modelBusy ? 'er-dot-busy' : 'er-dot-bad'}`,
                    'aria-hidden': true,
                  }),
                  h('span', { className: 'er-bundled-title' }, t('add.bundled.title')),
                  h('span', { className: 'er-bundled-meta' }, modelReady
                    ? t('add.bundled.downloaded')
                    : modelBusy
                      ? fill(t('local.downloading'), { n: Math.round((model?.progress ?? 0) * 100) })
                      : megabytes(model?.approximateBytes ?? model?.totalBytes)),
                  h('span', { className: 'er-grow' }),
                  modelReady
                    ? h('span', { className: 'er-bundled-done' }, t('add.bundled.added'))
                    : modelBusy || awaitBundled
                      ? h('span', { className: 'er-bundled-done' }, `${Math.round((model?.progress ?? 0) * 100)}%`)
                      : h('button', {
                        type: 'button', className: 'er-bundled-act',
                        onClick: () => { setAwaitBundled(true); installModel() },
                      }, t('add.bundled.download'))))),
          addError === '' ? null : h('p', { className: 'er-dialog-error', role: 'alert' }, addError),
          h('div', { className: 'er-dialog-foot' },
            h('button', {
              type: 'button', className: 'er-cta er-cta-quiet',
              onClick: () => setAddOpen(false),
            }, t('cancel')),
            h('button', {
              type: 'button', className: 'er-cta er-cta-strong',
              // Nothing to attach means nothing to add: the bundled model is
              // downloaded from its own row, not from an empty folder.
              disabled: validating
                || (addKind === 'api'
                  ? draftBaseUrl.trim() === '' || draftId.trim() === ''
                  : draftPath.trim() === ''),
              onClick: () => { void addSource() },
            }, validating ? t('add.validating') : (editingSource === '' ? t('add.add') : t('add.save'))))),
      ] : null

      /** One floating card serves the right-click lookup and the pinned dialog. */
      const cardHeight = Math.max(180, Math.min(panelHeight - 24, 420))
      const wordCard = card === null ? null : h('div', {
        className: `er-wordcard${card.pinned ? ' er-wordcard-pin' : ''}`,
        style: card.pinned
          ? { right: '12px', top: '12px', maxHeight: `${cardHeight}px` }
          : {
            left: `${Math.max(8, Math.min(card.x, Math.max(8, panelWidth - 272)))}px`,
            top: `${Math.max(8, Math.min(card.y, Math.max(8, panelHeight - cardHeight - 8)))}px`,
            maxHeight: `${cardHeight}px`,
          },
        role: 'dialog', 'aria-label': t('dict.title'),
        onMouseDown: (event) => event.stopPropagation(),
        onContextMenu: (event) => event.preventDefault(),
      },
        h('div', { className: 'er-wordcard-head' },
          card.pinned
            ? h('input', {
              className: 'er-input', value: query, autoFocus: true, spellCheck: false,
              placeholder: t('dict.placeholder'), 'aria-label': t('dict.title'),
              onChange: (event) => setQuery(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') { event.preventDefault(); void lookUp(query) }
                if (event.key === 'Escape') { event.preventDefault(); setCard(null) }
              },
            })
            : h('span', { className: 'er-wordcard-word' }, cardEntry?.word ?? card.word),
          h('button', {
            type: 'button', className: 'er-glyph', 'aria-label': t('close'), title: t('close'),
            onClick: () => setCard(null),
          }, glyph(ICON.close, 14))),
        cardState === 'loading'
          ? h('p', { className: 'er-wordcard-note' }, t('dict.loading'))
          : cardState === 'failed'
            ? h('p', { className: 'er-wordcard-note er-fine-err' }, cardError)
            : cardState === 'missing'
              ? h('p', { className: 'er-wordcard-note' }, t('dict.missing'))
              : cardEntry === null
                ? h('p', { className: 'er-wordcard-note' }, t('dict.placeholder'))
                : h('div', { className: 'er-wordcard-body' },
                  cardEntry.phonetic === '' ? null : h('div', { className: 'er-wordcard-ph' }, cardEntry.phonetic),
                  (cardEntry.senses ?? []).map((sense, at) => h('div', { key: at, className: 'er-sense' },
                    h('div', { className: 'er-sense-line' },
                      sense.pos === '' ? null : h('span', { className: 'er-sense-pos' }, sense.pos),
                      h('span', null, sense.def)),
                    sense.example === ''
                      ? null
                      : h('div', { className: 'er-sense-eg' },
                        h('span', null, sense.example),
                        h('button', {
                          type: 'button',
                          className: `er-say${sayingKey === `c:${at}` ? ' er-say-on' : ''}`,
                          title: t('words.sayExample'), 'aria-label': t('words.sayExample'),
                          onClick: () => { void speak(sense.example, `c:${at}`) },
                        }, glyph(ICON.speaker, 12))))),
                  Array.isArray(cardEntry.translation) && cardEntry.translation.length > 0
                    ? h('div', { className: 'er-wordcard-tr' }, cardEntry.translation.map((sense, at) => h('div', {
                      key: at, className: 'er-wordcard-trline',
                    },
                      sense.pos === '' ? null : h('span', { className: 'er-sense-pos' }, sense.pos),
                      h('span', null, sense.def))))
                    : null,
                  h('div', { className: 'er-wordcard-foot' },
                    cardState === 'ready' ? h('button', {
                      type: 'button', className: 'er-add er-add-plain',
                      onClick: () => saveWord({ ...cardEntry, word: cardEntry.word }),
                    }, words.some((item) => item.id === String(cardEntry.word).toLowerCase()) ? t('dict.saved') : t('dict.save')) : null)))

      // ------------------------------------------------------------------ body
      const errorBar = errorKind === ''
        ? null
        : h('div', { className: 'er-notice er-notice-err', role: 'alert' },
          h('span', null, t(`error.${errorKind}`)),
          errorKind === 'notInstalled'
            ? h('button', { type: 'button', className: 'er-cta er-cta-quiet', onClick: installModel }, t('local.download'))
            : errorKind === 'preparing'
              ? null
              : h('button', { type: 'button', className: 'er-cta er-cta-quiet', onClick: () => { void playAt(index) } }, t('retry')))

      /** Commit whatever the custom field holds, ignoring nonsense. */
      const commitWidth = () => {
        const value = Math.round(Number(widthDraft))
        setEditingWidth(false)
        if (!Number.isFinite(value)) return
        setCustomPct(Math.min(100, Math.max(20, value)))
      }
      const commitFont = () => {
        const value = Math.round(Number(fontDraft))
        setEditingFont(false)
        if (!Number.isFinite(value)) return
        setCustomPx(Math.min(40, Math.max(11, value)))
      }

      /** Two segmented controls, in the same shape as the rest of the panel. */
      const displayBar = view === 'editor' ? null : h('div', { className: 'er-display' },
        editingWidth
          ? h('div', { className: 'er-custom' },
            h('input', {
              className: 'er-input er-custom-input', type: 'number', min: '20', max: '100',
              value: widthDraft, autoFocus: true, 'aria-label': t('display.widthCustom'),
              placeholder: String(Math.round(customPct > 0 ? customPct : 100)),
              onChange: (event) => setWidthDraft(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') { event.preventDefault(); commitWidth() }
                if (event.key === 'Escape') { event.preventDefault(); setEditingWidth(false) }
              },
              onBlur: commitWidth,
            }),
            h('span', { className: 'er-custom-unit' }, t('display.percent')))
          : h('div', { className: 'er-seg er-seg-sm', role: 'radiogroup', 'aria-label': t('display.width') },
            WIDTH_STEPS.map((step) => h('button', {
              key: step.id, type: 'button', role: 'radio',
              'aria-checked': customPct === 0
                && (columnWidth === step.px || (columnWidth === 0 && step.px === DEFAULT_WIDTH)) ? 'true' : 'false',
              className: 'er-seg-btn',
              onClick: () => { setCustomPct(0); setColumnWidth(step.px) },
            }, t(`display.width.${step.id}`))),
            h('button', {
              type: 'button', role: 'radio',
              'aria-checked': customPct > 0 ? 'true' : 'false',
              className: 'er-seg-btn',
              onClick: () => { setWidthDraft(String(customPct > 0 ? customPct : 100)); setEditingWidth(true) },
            }, t('display.custom'))),
        editingFont
          ? h('div', { className: 'er-custom' },
            h('input', {
              className: 'er-input er-custom-input', type: 'number', min: '11', max: '40',
              value: fontDraft, autoFocus: true, 'aria-label': t('display.fontCustom'),
              placeholder: String(Math.round(customPx > 0 ? customPx : 14)),
              onChange: (event) => setFontDraft(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') { event.preventDefault(); commitFont() }
                if (event.key === 'Escape') { event.preventDefault(); setEditingFont(false) }
              },
              onBlur: commitFont,
            }),
            h('span', { className: 'er-custom-unit' }, t('display.px')))
          : h('div', { className: 'er-seg er-seg-sm', role: 'radiogroup', 'aria-label': t('display.font') },
            FONT_STEPS.map((step) => h('button', {
              key: step.id, type: 'button', role: 'radio',
              'aria-checked': customPx === 0 && Math.abs(fontScale - step.scale) < 0.01 ? 'true' : 'false',
              className: 'er-seg-btn',
              onClick: () => { setCustomPx(0); setFontScale(step.scale) },
            }, t(`display.font.${step.id}`))),
            h('button', {
              type: 'button', role: 'radio',
              'aria-checked': customPx > 0 ? 'true' : 'false',
              className: 'er-seg-btn',
              onClick: () => { setFontDraft(String(customPx > 0 ? customPx : 14)); setEditingFont(true) },
            }, t('display.custom'))),
        h('button', {
          type: 'button', className: 'er-glyph er-display-dict',
          title: t('dict.title'), 'aria-label': t('dict.title'),
          onClick: () => {
            setQuery('')
            setCardEntry(null)
            setCardState('idle')
            setCard({ word: '', x: 0, y: 0, pinned: true })
          },
        }, glyphLine(ICON.book, 16)))

      const body = view === 'words' ? wordsPage
        : view === 'library' ? library
        : view === 'editor' ? editor
          : [list, errorBar, transport]

      return h('div', {
        className: 'er-root', onKeyDown, tabIndex: 0, ref: rootRef,
        onMouseDown: (event) => { if (card !== null && card.pinned !== true && event.target === event.currentTarget) setCard(null) },
        style: { '--er-scale': String(effectiveScale) },
      },
        Styles(),
        header,
        displayBar,
        body,
        settingsCard,
        addDialog,
        wordCard,
        h('audio', { ref: audioRef }))
    }

    /** The panel's stylesheet, rendered as an element so unmounting removes it. */
    function Styles() {
      return h('style', null, `
/* ---- the panel sits on the host's paper; no cards, no shadows ---------- */
.er-root{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;box-sizing:border-box;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#111);font-family:var(--dsw-font-family,inherit);font-size:var(--dsh-content-font-size-secondary,13px);outline:none}
.er-root *,.er-root *::before,.er-root *::after{box-sizing:border-box}
.er-root audio{display:none}
.er-root :focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4b7bec);outline-offset:-1px}

/* ---- header: title holds the weight, controls are hairlines ----------- */
.er-head{display:flex;align-items:flex-start;gap:1px;padding:10px 8px 8px 12px;border-bottom:0.5px solid var(--dsw-alias-border-l3,var(--dsw-alias-border-l1,#e6e6e6))}
.er-head-text{flex:1;min-width:0;padding:3px 6px 0 0}
.er-title{font-size:calc(var(--dsh-content-font-size-secondary,13px) + 0.5px);font-weight:600;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.er-back-row{display:inline-flex;align-items:baseline;gap:4px;margin:1px 0 0 -3px;padding:1px 4px 1px 2px;border:0;border-radius:var(--dsw-radius-xs,5px);background:transparent;color:var(--dsw-alias-label-secondary,#888);font-size:calc(var(--dsh-content-font-size-secondary,13px) - 2px);line-height:1.4;cursor:pointer;font-family:inherit}
.er-back-arrow{font-size:1.05em;line-height:1}
.er-back-row:hover{color:var(--dsw-alias-label-primary,#111);background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}
.er-meta{margin-top:2px;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 2px);line-height:1.4;color:var(--dsw-alias-label-secondary,#666)}
.er-glyph{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:var(--dsw-radius-xs,5px);background:transparent;color:var(--dsw-alias-label-secondary,#666);cursor:pointer}
.er-glyph:hover:not(:disabled){color:var(--dsw-alias-label-primary,#111);background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}
.er-glyph:disabled{opacity:.38;cursor:default}
.er-glyph-on{color:var(--dsw-alias-brand-primary,#4b7bec)}
.er-capsule{flex:0 0 auto;display:inline-flex;align-items:center;gap:3px;height:24px;margin-left:3px;padding:0 4px 0 8px;max-width:104px;border:0.5px solid var(--dsw-alias-border-l3,var(--dsw-alias-border-l1,#dcdcdc));border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary,#666);font:inherit;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 2px);cursor:pointer}
.er-capsule:hover{color:var(--dsw-alias-label-primary,#111);border-color:var(--dsw-alias-border-l2,#c9c9c9)}
.er-capsule-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.er-capsule-busy .er-capsule-text{color:var(--dsw-alias-label-primary,#111)}
.er-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-idle-primary,#999);flex:0 0 auto}
.er-dot-run{background:var(--dsw-alias-brand-primary,#4b7bec);animation:er-pulse 1.2s ease-in-out infinite}
.er-dot-ok{background:var(--dsw-alias-state-success-primary,#2f9e58)}
.er-dot-busy{background:var(--dsw-alias-brand-primary,#4b7bec);animation:er-pulse 1.2s ease-in-out infinite}
.er-dot-bad{background:var(--dsw-alias-state-error-primary,#c0392b)}
.er-bundled-done{flex:0 0 auto;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 2px);color:var(--dsw-alias-label-secondary,#888);white-space:nowrap}
@keyframes er-pulse{50%{opacity:.3}}

/* ---- scrolling surfaces ---------------------------------------------- */
.er-scroll{flex:1;min-height:0;overflow-y:auto;scroll-behavior:smooth}
.er-empty{margin:0;padding:20px 14px;line-height:1.55;color:var(--dsw-alias-label-secondary,#666)}
.er-grow{flex:1}

/* ---- the reading surface: the one bold move -------------------------- */
.er-read{padding:2px 0 8px}
/* The sidebar is already narrow; a full-width view needs a readable measure. */
.er-fatal{display:flex;flex-direction:column;gap:8px;padding:16px;overflow:auto}
.er-fatal-title{margin:0;font-weight:600;color:var(--dsw-alias-state-error-primary,#c0392b)}
.er-fatal-body{margin:0;font-family:ui-monospace,monospace;font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-secondary,#666)}
.er-display{display:flex;align-items:center;gap:10px;padding:6px 12px;border-bottom:0.5px solid var(--dsw-alias-border-l3,var(--dsw-alias-border-l1,#ececec))}
/* Compact segmented control: the panel's own control shape, at reading-bar scale. */
.er-seg-sm{height:24px;padding:2px;gap:1px}
.er-seg-sm .er-seg-btn{font-size:calc(var(--dsh-content-font-size-secondary,13px) - 3px);padding:0 8px;font-weight:500}
.er-seg-sm .er-seg-btn[aria-checked='true']{font-weight:600}
.er-key-row{display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.er-key-row .er-fine{margin:0}
.er-custom{display:flex;align-items:center;gap:5px;height:24px}
.er-custom-input{width:64px;height:24px;padding:0 6px;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 2px)}
.er-custom-unit{font-size:calc(var(--dsh-content-font-size-secondary,13px) - 3px);color:var(--dsw-alias-label-secondary,#888)}
.er-body-wrap{position:relative;flex:1;min-height:0;display:flex;flex-direction:column}
.er-column{position:relative;margin:0 auto;flex:0 0 auto}
.er-passage{display:flex;gap:9px;width:100%;padding:5px 12px 5px 10px;border:0;border-left:2px solid transparent;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.er-passage:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.er-passage-on{border-left-color:var(--dsw-alias-brand-primary,#4b7bec);background:color-mix(in srgb, var(--dsw-alias-brand-primary,#4b7bec) 5%, transparent)}
.er-passage-on:hover{background:color-mix(in srgb, var(--dsw-alias-brand-primary,#4b7bec) 8%, transparent)}
.er-passage-para{margin-top:9px}
.er-mark{flex:0 0 auto;width:12px;padding-top:3px;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 2.5px);font-weight:600;color:var(--dsw-alias-label-secondary,#999);overflow:hidden}
.er-passage-on .er-mark{color:var(--dsw-alias-brand-primary,#4b7bec)}
.er-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.er-line{display:block;font-size:calc((var(--dsh-content-font-size-secondary,13px) + 1px) * var(--er-scale,1));line-height:1.62;overflow-wrap:anywhere}
.er-dim .er-line{color:var(--dsw-alias-label-secondary,#666)}
/* Only the sentence being read exposes words, so this box marks what is clickable. */
.er-passage-on .er-w{cursor:help;transition:background .12s ease,box-shadow .12s ease}
.er-passage-on .er-w:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4b7bec) 7%,transparent);box-shadow:0 0 0 1px color-mix(in srgb,var(--dsw-alias-brand-primary,#4b7bec) 26%,transparent)}
.er-wordcard{position:absolute;z-index:45;width:260px;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:8px;padding:10px;border:0.5px solid var(--dsw-alias-border-l3,var(--dsw-alias-border-l1,#dcdcdc));border-radius:var(--dsw-radius-md,10px);background:var(--dsw-alias-bg-base,#fff);box-shadow:var(--dsw-elevation-panel,0 10px 30px rgba(0,0,0,.18));animation:er-pop .12s ease-out}
.er-wordcard-pin{width:280px}
.er-wordcard-head{display:flex;align-items:center;gap:6px}
.er-wordcard-head .er-input{flex:1;min-width:0;height:26px}
.er-wordcard-word{flex:1;min-width:0;font-size:calc(var(--dsh-content-font-size-secondary,13px) + 2px);font-weight:600;color:var(--dsw-alias-label-primary,#111);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.er-wordcard-note{margin:2px 0 6px;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 2px);color:var(--dsw-alias-label-secondary,#888)}
.er-wordcard-body{display:flex;flex-direction:column;gap:7px}
.er-wordcard-ph{font-family:Georgia,serif;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);color:var(--dsw-alias-label-secondary,#888)}
.er-sense{display:flex;flex-direction:column;gap:2px}
.er-sense-line{font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);color:var(--dsw-alias-label-primary,#111);line-height:1.45}
.er-sense-pos{margin-right:5px;font-style:italic;color:var(--dsw-alias-label-secondary,#888)}
.er-say{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;margin-left:4px;padding:0;border:0;border-radius:var(--dsw-radius-xs,4px);background:transparent;color:var(--dsw-alias-label-secondary,#aaa);cursor:pointer;vertical-align:middle}
.er-say:hover{color:var(--dsw-alias-brand-primary,#4b7bec);background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.er-say-on{color:var(--dsw-alias-brand-primary,#4b7bec)}
.er-say:disabled{opacity:.3;cursor:default;background:transparent;color:var(--dsw-alias-label-secondary,#aaa)}
.er-say-ctx{margin-left:2px}
.er-sense-eg{display:flex;align-items:baseline;gap:2px;padding-left:8px;border-left:2px solid var(--dsw-alias-border-l3,var(--dsw-alias-border-l1,#e6e6e6));font-size:calc(var(--dsh-content-font-size-secondary,13px) - 2px);color:var(--dsw-alias-label-secondary,#888);line-height:1.4}
.er-wordcard-trline{display:flex;align-items:baseline;gap:4px;line-height:1.5}
.er-wordcard-tr{padding-top:6px;border-top:0.5px solid var(--dsw-alias-border-l3,var(--dsw-alias-border-l1,#ececec));font-family:Georgia,'Songti SC',serif;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);color:var(--dsw-alias-label-secondary,#666)}
.er-wordcard-foot{display:flex;justify-content:flex-end;margin-top:2px}
.er-display-dict{margin-left:auto}
.er-words{display:flex;flex-direction:column;gap:6px}
.er-wrow{display:flex;flex-direction:column;border-bottom:0.5px solid var(--dsw-alias-border-l3,var(--dsw-alias-border-l1,#ececec));border-left:2px solid transparent}
.er-wrow-on{border-left-color:var(--dsw-alias-brand-primary,#4b7bec);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4b7bec) 4%,transparent)}
.er-wrow-head{display:flex;align-items:center;gap:2px}
.er-wrow-head .er-entry-open{flex:1;min-width:0}
.er-wrow-body{display:flex;flex-direction:column;gap:4px;padding:0 12px 8px 12px;animation:er-pop .12s ease-out}
.er-wrow-head .er-entry-title{font-size:calc((var(--dsh-content-font-size-secondary,13px) + 1px) * var(--er-scale,1))}
.er-wrow-head .er-entry-meta{font-size:calc((var(--dsh-content-font-size-secondary,13px) - 2px) * var(--er-scale,1))}
.er-wrow-zh{display:flex;flex-direction:column;gap:2px;font-family:Georgia,'Songti SC',serif;font-size:calc((var(--dsh-content-font-size-secondary,13px) + 0.5px) * var(--er-scale,1));color:var(--dsw-alias-label-primary,#111);line-height:1.5}
.er-wrow-en{display:flex;flex-direction:column;gap:3px}
.er-wrow-ctx{display:flex;gap:6px;margin:2px 0 0;padding-top:6px;border-top:0.5px solid var(--dsw-alias-border-l3,var(--dsw-alias-border-l1,#ececec));font-family:Georgia,serif;font-size:calc(var(--dsh-content-font-size-secondary,13px) * var(--er-scale,1));line-height:1.5;color:var(--dsw-alias-label-secondary,#888)}
.er-wrow-ctx-label{flex:0 0 auto;font-family:inherit;font-style:normal;color:var(--dsw-alias-label-secondary,#aaa)}
.er-wrow-ctx-text{min-width:0;color:var(--dsw-alias-label-secondary,#777)}
.er-words-bar{padding:0 0 4px}
/* The current sentence is the only one at full strength; translation follows it. */
.er-passage-on .er-trans{color:var(--dsw-alias-label-primary,#111)}
.er-w{border-radius:3px;padding:0.05em 0.1em;margin:-0.05em -0.1em;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.er-w-on{background:color-mix(in srgb, var(--dsw-alias-brand-primary,#4b7bec) 24%, transparent)}
.er-passage-on .er-w-on{background:color-mix(in srgb, var(--dsw-alias-brand-primary,#4b7bec) 30%, transparent)}
.er-trans{display:block;margin-top:1px;font-family:Georgia,'Songti SC','STSong','Noto Serif CJK SC','Source Han Serif SC','SimSun',serif;font-size:calc((var(--dsh-content-font-size-secondary,13px) - 0.5px) * var(--er-scale,1));line-height:1.66;letter-spacing:.01em;color:var(--dsw-alias-label-secondary,#666);overflow-wrap:anywhere}

/* ---- transport -------------------------------------------------------- */
.er-transport{display:flex;align-items:center;gap:2px;padding:5px 8px 5px 6px;border-top:0.5px solid var(--dsw-alias-border-l3,var(--dsw-alias-border-l1,#e6e6e6))}
.er-play{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-primary,#111);cursor:pointer}
.er-play:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}
.er-play:disabled{opacity:.38;cursor:default}
.er-count{font-size:calc(var(--dsh-content-font-size-secondary,13px) - 2px);color:var(--dsw-alias-label-secondary,#777);white-space:nowrap;font-variant-numeric:tabular-nums}
.er-notice-text{margin-right:6px;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 2px);color:var(--dsw-alias-brand-primary,#3462c4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:46%}
.er-plain-select{height:24px;padding:0 3px;border:0.5px solid var(--dsw-alias-border-l3,var(--dsw-alias-border-l1,#dcdcdc));border-radius:var(--dsw-radius-xs,5px);background:transparent;color:var(--dsw-alias-label-secondary,#666);font:inherit;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 2px);cursor:pointer}
.er-plain-select:hover{color:var(--dsw-alias-label-primary,#111);border-color:var(--dsw-alias-border-l2,#c9c9c9)}
.er-rate{margin-left:4px}
.er-spin{width:13px;height:13px;border-radius:50%;border:1.5px solid color-mix(in srgb, currentColor 30%, transparent);border-top-color:currentColor;animation:er-spin .75s linear infinite;display:inline-block}
@keyframes er-spin{to{transform:rotate(360deg)}}

/* ---- notices ---------------------------------------------------------- */
.er-notice{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 12px;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 2px);line-height:1.45;color:var(--dsw-alias-label-secondary,#666);border-top:0.5px solid var(--dsw-alias-border-l3,var(--dsw-alias-border-l1,#e6e6e6))}
.er-notice-err{color:var(--dsw-alias-state-error-primary,#c0392b)}

/* ---- buttons ---------------------------------------------------------- */
.er-cta{display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 12px;border:0.5px solid var(--dsw-alias-border-l3,var(--dsw-alias-border-l1,#dcdcdc));border-radius:var(--dsw-radius-xs,5px);background:transparent;color:var(--dsw-alias-label-primary,#111);font:inherit;font-weight:500;cursor:pointer;white-space:nowrap}
.er-cta:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}
.er-cta:disabled{opacity:.38;cursor:not-allowed}
.er-cta-quiet{border-color:transparent;color:var(--dsw-alias-label-secondary,#666);font-weight:400}
.er-cta-quiet:hover:not(:disabled){color:var(--dsw-alias-label-primary,#111)}
.er-cta-strong{background:var(--dsw-alias-button-primary-fill,#111);border-color:transparent;color:var(--dsw-alias-label-primary-foreground,#fff)}
.er-cta-strong:hover:not(:disabled){background:var(--dsw-alias-button-primary-fill,#111);filter:brightness(1.08)}

/* ---- library ---------------------------------------------------------- */
.er-index-wrap{padding-bottom:2px}
.er-index .er-entry-title{font-size:calc((var(--dsh-content-font-size-secondary,13px) + 1px) * var(--er-scale,1))}
.er-index .er-entry-meta{font-size:calc((var(--dsh-content-font-size-secondary,13px) - 2px) * var(--er-scale,1))}
.er-index{list-style:none;margin:0;padding:0}
.er-entry{display:flex;align-items:stretch;border-bottom:0.5px solid var(--dsw-alias-border-l3,var(--dsw-alias-border-l1,#ececec));border-left:2px solid transparent}
.er-entry-on{border-left-color:var(--dsw-alias-brand-primary,#4b7bec)}
.er-entry-open{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;padding:9px 4px 9px 10px;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.er-entry-open:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.er-entry-title{font-weight:500;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.er-entry-meta{font-size:calc(var(--dsh-content-font-size-secondary,13px) - 2px);color:var(--dsw-alias-label-secondary,#777)}
.er-entry-act{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:24px;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#999);cursor:pointer;border-radius:var(--dsw-radius-xs,5px)}
.er-entry-act:hover{color:var(--dsw-alias-label-primary,#111);background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.er-entry-act-on{color:var(--dsw-alias-brand-primary,#4b7bec)}
.er-entry-pin{display:inline-flex;margin-right:4px;vertical-align:-1px;color:var(--dsw-alias-brand-primary,#4b7bec)}
.er-source-act{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#999);cursor:pointer;border-radius:var(--dsw-radius-xs,5px)}
.er-source-act:hover{color:var(--dsw-alias-label-primary,#111);background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.er-entry-del{flex:0 0 auto;min-width:28px;padding:0 8px;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#888);font:inherit;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 2px);cursor:pointer}
.er-entry-del:hover,.er-entry-del-on{color:var(--dsw-alias-state-error-primary,#c0392b);background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.er-index-foot{padding:10px 10px 14px}

/* ---- editor ----------------------------------------------------------- */
.er-editor{flex:1;min-height:0;display:flex;flex-direction:column;gap:9px;padding:10px 12px 12px;overflow:auto}
.er-textarea{flex:1;min-height:130px;resize:vertical;padding:9px 10px;border:0.5px solid var(--dsw-alias-border-l3,var(--dsw-alias-border-l1,#dcdcdc));border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-bg-base,#fff);color:inherit;font:inherit;line-height:1.62}
.er-hint{margin:0;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 2px);line-height:1.5;color:var(--dsw-alias-label-secondary,#666)}
.er-editor-bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.er-inline{display:inline-flex;align-items:center;gap:5px}
.er-inline-label{font-size:calc(var(--dsh-content-font-size-secondary,13px) - 2px);color:var(--dsw-alias-label-secondary,#666)}

/* ---- settings sheet: the only elevated surface ------------------------ */
.er-catcher{position:fixed;inset:0;z-index:40}
.er-veil{position:absolute;inset:0;z-index:50;background:color-mix(in srgb, var(--dsw-alias-label-primary,#111) 16%, transparent);animation:er-fade .12s ease-out}
@keyframes er-fade{from{opacity:0}}
.er-dialog{position:absolute;z-index:51;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;flex-direction:column;width:min(322px,calc(100% - 20px));max-height:calc(100% - 22px);overflow:hidden;border:0.5px solid var(--dsw-alias-border-l3,var(--dsw-alias-border-l1,#dcdcdc));border-radius:var(--dsw-radius-md,10px);background:var(--dsw-alias-bg-base,#fff);box-shadow:var(--dsw-elevation-panel,0 18px 44px rgba(0,0,0,.22));animation:er-fade .14s ease-out}
.er-dialog-head{display:flex;align-items:center;gap:8px;padding:10px 8px 10px 14px;border-bottom:0.5px solid var(--dsw-alias-border-l3,var(--dsw-alias-border-l1,#ececec))}
.er-dialog-title{flex:1;margin:0;font-size:calc(var(--dsh-content-font-size-secondary,13px) + 0.5px);font-weight:600}
.er-dialog-body{overflow-y:auto;padding:12px 14px 14px}
.er-dialog-error{margin:0;padding:0 16px 10px;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1.5px);line-height:1.5;text-align:center;color:var(--dsw-alias-state-error-primary,#c0392b);overflow-wrap:anywhere}
.er-dialog-foot{display:flex;justify-content:flex-end;gap:6px;padding:0 14px 14px}
.er-bundled{display:flex;align-items:center;gap:6px;margin-top:10px;padding:4px 7px;border:0.5px solid var(--dsw-alias-border-l3,var(--dsw-alias-border-l1,#dcdcdc));border-radius:var(--dsw-radius-xs,5px)}
.er-bundled-title{font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1.5px);font-weight:500;white-space:nowrap}
.er-bundled-meta{min-width:0;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 2.5px);color:var(--dsw-alias-label-secondary,#888);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.er-bundled-act{flex:0 0 auto;padding:1px 5px;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-brand-primary,#3462c4);font:inherit;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 2px);cursor:pointer;white-space:nowrap}
.er-bundled-act:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}
.er-dir{display:flex;align-items:center;gap:6px}
.er-keyline{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:5px}
.er-keyline .er-fine{margin:0;min-width:0}
.er-probe-ok{font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1.5px);color:var(--dsw-alias-state-success-primary,#2f9e58)}
.er-probe-bad{font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1.5px);line-height:1.45;color:var(--dsw-alias-state-error-primary,#c0392b);overflow-wrap:anywhere}
.er-dir .er-input{flex:1}
.er-sources{list-style:none;margin:9px 0 0;padding:0;display:flex;flex-direction:column;gap:1px}
.er-source{display:flex;align-items:center;gap:2px;border-radius:var(--dsw-radius-xs,5px)}
.er-source:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.er-source-pick{flex:1;min-width:0;display:flex;align-items:center;gap:8px;padding:6px;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;border-radius:inherit}
.er-radio{flex:0 0 auto;width:13px;height:13px;border-radius:50%;border:1.5px solid var(--dsw-alias-border-l2,#bbb)}
.er-source-on .er-radio{border-color:var(--dsw-alias-brand-primary,#4b7bec);background:var(--dsw-alias-brand-primary,#4b7bec);box-shadow:inset 0 0 0 3px var(--dsw-alias-bg-base,#fff)}
.er-source-text{display:flex;flex-direction:column;gap:1px;min-width:0}
.er-source-name{font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.er-source-meta{font-size:calc(var(--dsh-content-font-size-secondary,13px) - 2.5px);color:var(--dsw-alias-label-secondary,#888);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.er-source-del{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#999);cursor:pointer;border-radius:var(--dsw-radius-xs,5px)}
.er-source-del:hover{color:var(--dsw-alias-state-error-primary,#c0392b);background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.er-add{display:inline-flex;align-items:center;gap:5px;margin-top:5px;padding:4px 6px;border:0;border-radius:var(--dsw-radius-xs,5px);background:transparent;color:var(--dsw-alias-brand-primary,#3462c4);font:inherit;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);cursor:pointer}
.er-add:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
/* A text-only action lines up with the section's copy, not its controls. */
.er-add-plain{padding-left:0;padding-right:0;margin-left:0}
.er-add-plain:hover{background:transparent;text-decoration:underline}
.er-voice-acts{display:flex;gap:14px;align-items:center}
.er-card{position:fixed;z-index:41;display:flex;flex-direction:column;max-height:min(72vh,560px);overflow:hidden;border:0.5px solid var(--dsw-alias-border-l3,var(--dsw-alias-border-l1,#dcdcdc));border-radius:var(--dsw-radius-md,10px);background:var(--dsw-alias-bg-base,#fff);box-shadow:var(--dsw-elevation-panel,0 10px 30px rgba(0,0,0,.18));animation:er-pop .14s ease-out}
@keyframes er-pop{from{opacity:0;transform:translateY(-3px)}}
.er-card-head{display:flex;align-items:center;gap:8px;padding:9px 8px 9px 14px;border-bottom:0.5px solid var(--dsw-alias-border-l3,var(--dsw-alias-border-l1,#ececec))}
.er-card-title{flex:1;margin:0;font-size:calc(var(--dsh-content-font-size-secondary,13px) + 0.5px);font-weight:600}
.er-card-hint{font-size:calc(var(--dsh-content-font-size-secondary,13px) - 2.5px);color:var(--dsw-alias-label-secondary,#888);white-space:nowrap}
.er-card-body{overflow-y:auto;overscroll-behavior:contain}
.er-card-body .er-sect:last-of-type{border-bottom:0}
.er-card-foot{padding:2px 14px 14px}
.er-facts{display:flex;flex-direction:column;margin-top:9px}
.er-fact{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:3px 0;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:1.45}
.er-fact-label{flex:0 0 auto;color:var(--dsw-alias-label-secondary,#666)}
.er-fact-value{min-width:0;text-align:right;color:var(--dsw-alias-label-primary,#111);overflow-wrap:anywhere}
.er-sect{padding:11px 14px;border-bottom:0.5px solid var(--dsw-alias-border-l3,var(--dsw-alias-border-l1,#ececec))}
.er-sect-title{margin:0 0 7px;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 2px);font-weight:600;color:var(--dsw-alias-label-secondary,#666)}

.er-seg{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:2px;height:28px;padding:2px;border-radius:var(--dsw-radius-xs,6px);background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}
.er-seg-btn{display:inline-flex;align-items:center;justify-content:center;min-width:0;border:0;border-radius:calc(var(--dsw-radius-xs,6px) - 1.5px);background:transparent;color:var(--dsw-alias-label-secondary,#666);font:inherit;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 2px);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.er-seg-btn:hover{color:var(--dsw-alias-label-primary,#111)}
.er-seg-btn[aria-checked='true']{background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:var(--dsw-elevation-soft,0 1px 2px rgba(0,0,0,.08));color:var(--dsw-alias-label-primary,#111);font-weight:600}
.er-field{display:flex;flex-direction:column;gap:3px;margin-top:8px}
.er-field-label{font-size:calc(var(--dsh-content-font-size-secondary,13px) - 2px);color:var(--dsw-alias-label-secondary,#666)}
.er-pair{display:flex;gap:8px}
.er-pair > .er-field{flex:1;min-width:0}
.er-input{height:28px;width:100%;min-width:0;padding:0 8px;border:0.5px solid var(--dsw-alias-border-l3,var(--dsw-alias-border-l1,#dcdcdc));border-radius:var(--dsw-radius-xs,5px);background:transparent;color:inherit;font:inherit;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px)}
.er-select{height:28px;width:100%;min-width:0;padding:0 5px;border:0.5px solid var(--dsw-alias-border-l3,var(--dsw-alias-border-l1,#dcdcdc));border-radius:var(--dsw-radius-xs,5px);background:transparent;color:inherit;font:inherit;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);cursor:pointer}
.er-fine{margin:6px 0 0;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 2px);line-height:1.5;color:var(--dsw-alias-label-secondary,#666);overflow-wrap:anywhere}
.er-fine-dim{opacity:.8}
.er-fine-err{color:var(--dsw-alias-state-error-primary,#c0392b)}
.er-model{display:flex;flex-direction:column;align-items:flex-start;gap:5px;margin-top:3px}
.er-meter{width:100%;height:4px;border-radius:2px;overflow:hidden;background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.08))}
.er-meter-fill{height:100%;border-radius:2px;background:var(--dsw-alias-brand-primary,#4b7bec);transition:width .25s ease}
.er-toggle-row{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:5px 0;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;text-align:left}
.er-track{position:relative;flex:0 0 auto;width:32px;height:18px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.12));transition:background .15s ease}
.er-track-on{background:var(--dsw-alias-brand-primary,#4b7bec)}
.er-knob{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-bg-base,#fff);transition:transform .15s ease}
.er-track-on .er-knob{transform:translateX(14px)}
@media (prefers-reduced-motion: reduce){.er-scroll{scroll-behavior:auto}.er-spin{animation:none}.er-dot-run{animation:none}.er-meter-fill{transition:none}.er-track,.er-knob{transition:none}.er-card{animation:none}}
`)
    }

    /** The sidebar panel's icon; the sidebar owns the button itself. */
    function PanelIcon(props) {
      const size = typeof props?.size === 'number' ? props.size : 18
      return glyphLine(ICON.headset, size, HEADSET_BOX)
    }

    /** Composer-row button that opens the panel. */
    function Launcher(props) {
      const localeId = useSnapshot(props.localeSource.subscribe, props.localeSource.getSnapshot)
      const dict = DICT[String(localeId).toLowerCase().startsWith('zh') ? 'zh' : 'en']
      return h('button', {
        type: 'button',
        className: 'er-launch',
        title: dict['launcher'],
        'aria-label': dict['launcher'],
        onClick: props.openTab,
      }, h('style', null, `
.er-launch{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;box-sizing:border-box;border-radius:var(--dsw-radius-xs,6px);border:0.5px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary,#666);cursor:pointer;padding:0}
.er-launch:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#111)}
.er-launch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4b7bec);outline-offset:1px}
`), glyphLine(ICON.headset, 17, HEADSET_BOX))
    }

    return {
      inject: ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight'],
      /** Pure helpers, exposed so the panel's parsing can be tested without a browser. */
      internals: { parseDialogue, splitSentences, hashText, titleFor, EDGE_VOICES, LOCAL_VOICES, SPEEDS, DICT, buildTimings, wordsOf, normalizeWord },

      /**
       * Register the tab type, its body, the guide card, and the composer launcher.
       * @param {object} ctx - client root context.
       */
      apply(ctx) {
        // Services stay in this closure and reach components as observable
        // sources or callbacks, never as `ctx`.
        const localeSource = {
          getSnapshot: () => {
            try { return String(ctx.locale.getLocale().active ?? '') } catch { return '' }
          },
          subscribe: (listener) => ctx.locale.subscribe(listener),
        }
        const localised = () => DICT[String(localeSource.getSnapshot()).toLowerCase().startsWith('zh') ? 'zh' : 'en']
        const openTab = () => {
          try { ctx.sidebarRight.openTab(KIND) } catch { /* no session on screen yet */ }
        }

        ctx.effect(() => ctx.locale.register(NS, {
          en: Object.fromEntries(Object.entries(DICT.en)),
          zh: Object.fromEntries(Object.entries(DICT.zh)),
        }), 'english-reader: copy')

        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: TAB_ID,
          kind: KIND,
          // Keep the panel mounted while the sidebar is collapsed: the point of
          // a sidebar reader is to listen while the conversation is in view.
          keepMounted: true,
          title: () => localised()['tab.title'],
          guide: [{
            id: 'main',
            order: 40,
            icon: GuideGlyph,
            title: () => localised()['guide.title'],
            description: () => localised()['guide.desc'],
          }],
        }), 'english-reader: tab type')

        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () =>
          ctx.slots.register({
            name: 'sidebar.right.pane.tab', key: TAB_ID, locale: NS,
            // A model the user already has is picked with the host's own directory
            // dialog; the panel never sees ctx itself.
            inject: () => ({
              localeSource,
              pickDirectory: () => (typeof ctx.uiWorkspace?.pickDirectory === 'function'
                ? ctx.uiWorkspace.pickDirectory()
                : Promise.resolve(null)),
            }),
          }, Reader))
          , 'english-reader: panel body')

        // The panel is also a session view, so it can be shown full width beside
        // 对话 / 轨迹 / 上下文 instead of only in the right column.
        // The full-area page: a sidebar panel button whose id selects a `main`
        // key. This is how dsh-context and the team view get a whole page with no
        // composer, while the session header and its tabs stay untouched.
        ctx.effect(() => ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 30,
            locale: NS,
            label: () => localised()['panel.label'],
          }, PanelIcon))
          , 'english-reader: sidebar panel button')

        ctx.effect(() => ctx.slots.inject('main', () =>
          ctx.slots.register({
            name: 'main',
            key: PANEL_ID,
            inject: () => ({
              localeSource,
              pickDirectory: () => (typeof ctx.uiWorkspace?.pickDirectory === 'function'
                ? ctx.uiWorkspace.pickDirectory()
                : Promise.resolve(null)),
            }),
          }, Reader))
          , 'english-reader: full page')



        ctx.effect(() => ctx.slots.inject('conversation.input.left', () =>
          ctx.slots.register({
            name: 'conversation.input.left',
            id: TAB_ID,
            order: 20,
            label: () => localised()['launcher'],
            inject: () => ({ localeSource, openTab }),
          }, Launcher))
          , 'english-reader: composer launcher')
      },
    }
  },
})