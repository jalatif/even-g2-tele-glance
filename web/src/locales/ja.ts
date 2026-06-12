import en from './en'
import type { LocaleStrings } from './en'

// All strings are Hepburn-style Rōmaji for readability on the glasses display.
const ja: LocaleStrings = {
  ...en,
  _cjkTransliterate: true,

  titleTelegram: 'Tereguramu',
  titleTelegramLogin: 'Tereguramu Roguin',
  titleTopics: 'Topikku',
  titleChats: 'Chatto',
  titleNewTelegram: 'Shinki Tereguramu',
  titleRecordingReply: 'Henji Rokuon-chuu',
  titleRecording: 'Rokuon-chuu',
  titleTranscribing: 'Moji-ka-chuu',
  titleConfirmReply: 'Henji Kakunin',
  titleSendingReply: 'Henji Sōshin-chuu',
  titleReplySent: 'Henji Sōshin-zumi',
  titleError: 'Eraa',

  statusSent: 'Sōshin-zumi',
  statusOlderMessages: 'Furui Messēji',
  statusNewerMessages: 'Atarashii Messēji',
  statusNoOlderMessages: 'Furui Messēji nashi',
  statusNewReply: 'Shinki Henji',
  statusLoadingOlderMessages: 'Furui messēji yomikomi-chuu...',
  statusLoadingMessages: 'Messēji yomikomi-chuu...',
  footerSwipeChats: 'Chatto suwaipu | Oshite hiraku',
  footerTapToOpenTopic: 'TAPPU DE TOPIKKU HIRAKU',
  footerSwipeScroll: 'Suwaipu sukurōru | Klikku rokuon | Daburu kurikku modoru',
  footerClickStop: 'Klikku teishi | Daburu kurikku kyanseru',
  footerSwipeSelect: 'Suwaipu sentaku | Oshite kakunin',
  footerDoubleClickDismiss: 'Daburu kurikku tojiru',
  footerLoadingMessages: 'Messēji yomikomi-chuu...',

  bodyNewMessage: 'Shinki messēji',
  bodyClickToOpen: 'Kurikku de hiraku.',
  bodyPressToRetry: 'Oshite risaishō. Daburu kurikku modoru.',
  bodyConvertingVoice: 'Onsei henkan-chuu...',

  senderMe: 'Jibun',
  senderUnknown: 'Fumei',

  phoneScreenOff: 'Megane gamen ofu...',
  phoneRecording: 'Megane de rokuon-chuu...',
  phoneTranscribing: 'Onsei henji moji-ka-chuu...',
  phoneConfirmOnGlasses: 'Megane de henji kakunin: ',
  phoneSendingReply: 'Henji sōshin-chuu...',
  phoneReplySent: 'Henji sōshin-zumi.',
  phoneNoMessages: 'Messēji arimasen.',
  phoneOpenChatToSend: 'Chatto ka topikku o hiraite henji sōshin.',
  phoneSendFailed: 'Sōshin shippai',
  phoneCodeSendFailed: 'Kōdo sōshin dekimasen deshita',
  phoneCodeVerifyFailed: 'Kōdo kakunin dekimasen deshita',

  phoneChatsHeading: 'Chatto',
  phoneTelegramLoginHeading: 'Tereguramu Roguin',
  phoneTelegramSessionHeading: 'Tereguramu Sesshon',
  phoneNewTelegramHeading: 'Shinki Tereguramu',
  phoneErrorHeading: 'Eraa',
  phoneVerificationCode: 'Kakunin kōdo',
  phoneMobileNumber: 'Keitai bangō to kuni kōdo',
  phoneSend: 'Sōshin',
  phoneVerifyCode: 'Kōdo Kakunin',
  phoneSendLoginCode: 'Roguin Kōdo Sōshin',
  phoneOpenThread: 'Thread Hiraku',
  phoneRetry: 'Risai',

  phoneSettingsHeading: 'Settei',
  phoneAlreadyConnected: 'Setsuzoku-zumi',
  phoneNotConnected: 'Mi-setsuzoku',
  phoneConfigured: 'Settei-zumi',
  phoneRequired: 'Hitsuyō',
  phoneStoredOnPhone: 'Kono denwa ni hozon',
  phoneBackendSessionActive: 'Bakkuendo sesshon katsudō-chuu',
  phoneNotLoggedIn: 'Mada roguin shiteimasen',
  phoneSaveSettings: 'Settei Hozon',
  phoneSaved: 'Hozon-zumi',
  phoneReset: 'Risetto',
  phoneDisconnectTelegram: 'Tereguramu Setsudan',
  phoneDisconnecting: 'Setsudan-chuu...',

  phoneAppTitle: 'TereGuransu',
  phoneSettingsTab: 'Settei',
  phoneBack: 'Modoru',
  phoneBackToChat: 'Chatto ni modoru',
  phoneOpenSettings: 'Settei hiraku',

  errorBackendUnreachable:
    'Bakkuendo ni setsuzoku dekimasen. Settei de Bakkuendo URL o nyūryoku shi, bakkuendo sābā ga kidō shiteiru koto o kakunin shite kudasai.',
  errorBackendTimeout:
    'Bakkuendo rikuesuto ga {seconds}byō de taimuauto. Sābā ga fukatō ka kotei shiteiru kanōsei ga arimasu. Sai-shikō suru ka bakkuendo o kakunin shite kudasai.',
  errorEncryptedAuthMissing:
    'Angō-ka ninshō ni wa Bakkuendo kyōyū shīkuretto, Tereguramu API ID, oyobi Tereguramu API hasshu ga TereGuransu Settei ni hitsuyō desu.',
  errorSharedSecretRequired:
    'Bakkuendo kyōyū shīkuretto ga bakkuendo ōtō no fukugō-ka ni hitsuyō desu.',
  errorEncryptedMalformed: 'Angō-ka bakkuendo ōtō ga fukanzen desu',
  errorWebCryptoRequired:
    'Angō-ka bakkuendo ninshō ni wa WebCrypto ga hitsuyō desu. Pakkēji app, localhost, HTTPS, matawa WebCrypto taiō no burauzā o shiyō shite kudasai.',
  errorUpdateStreamUnavailable: 'Kōshin sutorīmu ga riyō fuka',
  errorUpdateStreamFailed: 'Kōshin sutorīmu ga shippai shimashita',
  errorStarting: 'Kaidō-chuu...',
  errorStartupFailed: 'Kaidō shippai',
  errorUnexpected: 'Yoki senu eraa ga hassei shimashita',

  authNeedsSetup:
    'Settei o hiraki, Bakkuendo URL, Kyōyū Shīkuretto, Tereguramu API ID, oyobi Tereguramu API Hasshu o nyūryoku shite kudasai. Sonogo app o sai-kidō shite kudasai.',
  authSignedOut: 'Tappu shite denwa bangō de roguin shite kudasai.',
  authPhonePending: 'Denwa ni todoku kakunin kōdo o nyūryoku shite kudasai.',

  bridgeEmptyList: 'Karappo',
}

export default ja
