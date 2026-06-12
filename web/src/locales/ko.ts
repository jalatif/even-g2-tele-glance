import en from './en'
import type { LocaleStrings } from './en'

// Uses Revised Romanization for readability on the glasses display.
const ko: LocaleStrings = {
  ...en,
  _cjkTransliterate: true,

  titleTelegram: 'Tellegeuraem',
  titleTelegramLogin: 'Tellegeuraem Rogeuin',
  titleTopics: 'Topik',
  titleChats: 'Chaeting',
  titleNewTelegram: 'Sae Tellegeuraem',
  titleRecordingReply: 'Dapjang Nogeum-jung',
  titleRecording: 'Nogeum-jung',
  titleTranscribing: 'Munjahwa-jung',
  titleConfirmReply: 'Dapjang Hwagin',
  titleSendingReply: 'Dapjang Jeonsong-jung',
  titleReplySent: 'Dapjang Jeonsong-wallyo',
  titleError: 'Olyu',

  statusSent: 'Jeonsong-wallyo',
  statusOlderMessages: 'Ijeon Mesiji',
  statusNewerMessages: 'Sae Mesiji',
  statusNoOlderMessages: 'Ijeon mesiji eopseum',
  statusNewReply: 'Sae Dapjang',
  statusLoadingOlderMessages: 'Ijeon mesiji loding-jung...',
  statusLoadingMessages: 'Mesiji loding-jung...',
  footerSwipeChats: 'Chaeting seuwaipeu | Nulleo yeolgi',
  footerTapToOpenTopic: 'TAEPHAE TOPIK YEOLGI',
  footerSwipeScroll: 'Seuwaipeu seukeurol | Keulrik nogeum | Deobeul keulrik dwiro',
  footerClickStop: 'Keulrik jeongji | Deobeul keulrik chwiso',
  footerSwipeSelect: 'Seuwaipeu seontaek | Nulleo hwagin',
  footerDoubleClickDismiss: 'Deobeul keulrik dadgi',
  footerLoadingMessages: 'Mesiji loding-jung...',

  bodyNewMessage: 'Sae mesiji',
  bodyClickToOpen: 'Keulrik-hae yeolgi.',
  bodyPressToRetry: 'Nulleo jaesido. Deobeul keulrik dwiro.',
  bodyConvertingVoice: 'Eumseong byeonhwan-jung...',

  senderMe: 'Na',
  senderUnknown: 'Al su eopseum',

  phoneScreenOff: 'Ankyeong hwamyeon kkeojim...',
  phoneRecording: 'Ankyeong-eseo nogeum-jung...',
  phoneTranscribing: 'Eumseong dapjang munjahwa-jung...',
  phoneConfirmOnGlasses: 'Ankyeong-eseo dapjang hwagin: ',
  phoneSendingReply: 'Dapjang jeonsong-jung...',
  phoneReplySent: 'Dapjang jeonsong-wallyo.',
  phoneNoMessages: 'Mesiji eopseum.',
  phoneOpenChatToSend: 'Chaeting-ina topik-eul yeoreo dapjang-eul bonaeseyo.',
  phoneSendFailed: 'Jeonsong silpae',
  phoneCodeSendFailed: 'Kodeu-reul bonael su eopseumnida',
  phoneCodeVerifyFailed: 'Kodeu-reul hwaginhal su eopseumnida',

  phoneChatsHeading: 'Chaeting',
  phoneTelegramLoginHeading: 'Tellegeuraem Rogeuin',
  phoneTelegramSessionHeading: 'Tellegeuraem Sesyeon',
  phoneNewTelegramHeading: 'Sae Tellegeuraem',
  phoneErrorHeading: 'Olyu',
  phoneVerificationCode: 'Hwagin kodeu',
  phoneMobileNumber: 'Hyudae jeonhwa beonho-wa gukga kodeu',
  phoneSend: 'Bonaegi',
  phoneVerifyCode: 'Kodeu Hwagin',
  phoneSendLoginCode: 'Rogeuin Kodeu Bonaegi',
  phoneOpenThread: 'Seuredeu Yeolgi',
  phoneRetry: 'Jaesido',

  phoneSettingsHeading: 'Seoljeong',
  phoneAlreadyConnected: 'Iimi yeongyeol-doeeo isseumnida',
  phoneNotConnected: 'Yeongyeol-doeji anhasseumnida',
  phoneConfigured: 'Seoljeong-wallyo',
  phoneRequired: 'Pilsu',
  phoneStoredOnPhone: 'I pon-eman jeojangdoe-eo isseumnida',
  phoneBackendSessionActive: 'Baek-endeu sesyeon hwalseong-jung',
  phoneNotLoggedIn: 'Ajik rogeuin-haji anhasseumnida',
  phoneSaveSettings: 'Seoljeong Jeojang',
  phoneSaved: 'Jeojangdoem',
  phoneReset: 'Chogihwa',
  phoneDisconnectTelegram: 'Tellegeuraem Yeongyeol Haeje',
  phoneDisconnecting: 'Haeje-jung...',

  phoneAppTitle: 'TelleGeullaenseu',
  phoneSettingsTab: 'Seoljeong',
  phoneBack: 'Dwiro',
  phoneBackToChat: 'Chaeting-euro doragagi',
  phoneOpenSettings: 'Seoljeong yeolgi',

  errorBackendUnreachable:
    'Baek-endeu-e yeongyeolhal su eopseumnida. Seoljeong-eseo Baek-endeu URL-eul ibnyeok-hago baek-endeu seobeo-ga silhaeng-jung-inji hwagin-hasipsio.',
  errorBackendTimeout:
    'Baek-endeu yogu-ga {seconds}cho hue taim-aut. Seobeo-e yeongyeolhal su eopgeona jungdan-doen geot gatseumnida. Dasi sido-hageona baek-endeu-reul hwagin-hasipsio.',
  errorEncryptedAuthMissing:
    'Amhohwa injung-eun TelleGeullaenseu Seoljeong-eseo Baek-endeu gongyu sikeurit, Tellegeuraem API ID, geurigo Tellegeuraem API haesi-ga pilsu-hamnida.',
  errorSharedSecretRequired:
    'Baek-endeu gongyu sikeurit-i baek-endeu eungdap boghohwa-e pilsu-hamnida.',
  errorEncryptedMalformed: 'Amhohwa baek-endeu eungdap-i sonsang-doeeo isseumnida',
  errorWebCryptoRequired:
    'Amhohwa baek-endeu injung-eun WebCrypto-ga pilsu-hamnida. Paekiji aep, localhost, HTTPS, hogeun WebCrypto jiwon beuraujeo-reul sayong-hasipsio.',
  errorUpdateStreamUnavailable: 'Eopdeiteu seuteurim sayong bulga',
  errorUpdateStreamFailed: 'Eopdeiteu seuteurim silpae',
  errorStarting: 'Sijak-jung...',
  errorStartupFailed: 'Sijak silpae',
  errorUnexpected: 'Yesangchi aneun olyu-ga balsaenghaessseumnida',

  authNeedsSetup:
    'Seoljeong-eul yeolgo Baek-endeu URL, Gongyu Sikeurit, Tellegeuraem API ID, geurigo Tellegeuraem API Haesi-reul ibnyeok-hasipsio. Geu hu aep-eul jaesijak-hasipsio.',
  authSignedOut: 'Taep-hae jeonhwa beonho-ro rogeuin-hasipsio.',
  authPhonePending: 'Jeonhwa-ro jeonsongdoen hwagin kodeu-reul ibnyeok-hasipsio.',

  bridgeEmptyList: 'Bieo isseumnida',
}

export default ko
