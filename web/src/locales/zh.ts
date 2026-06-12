import en from './en'
import type { LocaleStrings } from './en'

// All strings are Hànyǔ Pīnyīn for readability on the glasses display.
const zh: LocaleStrings = {
  ...en,
  _cjkTransliterate: true,

  titleTelegram: 'Telegram',
  titleTelegramLogin: 'Telegram Denglu',
  titleTopics: 'Huati',
  titleChats: 'Liaotian',
  titleNewTelegram: 'Xin Telegram',
  titleRecordingReply: 'Luyin Huifu-zhong',
  titleRecording: 'Luyin-zhong',
  titleTranscribing: 'Zhuanxie-zhong',
  titleConfirmReply: 'Queren Huifu',
  titleSendingReply: 'Fasong Huifu-zhong',
  titleReplySent: 'Huifu Yi Fasong',
  titleError: 'Cuowu',

  statusSent: 'Yi Fasong',
  statusOlderMessages: 'Gengzao Xiaoxi',
  statusNewerMessages: 'Xin Xiaoxi',
  statusNoOlderMessages: 'Wu Gengzao Xiaoxi',
  statusNewReply: 'Xin Huifu',
  statusLoadingOlderMessages: 'Jiazai gengzao xiaoxi...',
  statusLoadingMessages: 'Jiazai xiaoxi...',
  footerSwipeChats: 'Huadong liaotian | Anxia dakai',
  footerTapToOpenTopic: 'DIANJI DAKAI HUATI',
  footerSwipeScroll: 'Huadong gundong | Dianji luyin | Shuangji fanhui',
  footerClickStop: 'Dianji tingzhi | Shuangji quxiao',
  footerSwipeSelect: 'Huadong xuanze | Anxia queren',
  footerDoubleClickDismiss: 'Shuangji guanbi',
  footerLoadingMessages: 'Jiazai xiaoxi...',

  bodyNewMessage: 'Xin xiaoxi',
  bodyClickToOpen: 'Dianji dakai.',
  bodyPressToRetry: 'Anxia chongshi. Shuangji fanhui.',
  bodyConvertingVoice: 'Yuyin zhuanhuan-zhong...',

  senderMe: 'Wo',
  senderUnknown: 'Weizhi',

  phoneScreenOff: 'Yanjing pingmu guanbi...',
  phoneRecording: 'Yanjing luyin-zhong...',
  phoneTranscribing: 'Yuyin huifu zhuanxie-zhong...',
  phoneConfirmOnGlasses: 'Zai yanjing shang queren huifu: ',
  phoneSendingReply: 'Fasong huifu-zhong...',
  phoneReplySent: 'Huifu yi fasong.',
  phoneNoMessages: 'Meiyou xiaoxi.',
  phoneOpenChatToSend: 'Dakai liaotian huo huati lai fasong huifu.',
  phoneSendFailed: 'Fasong shibai',
  phoneCodeSendFailed: 'Wufa fasong yanzhengma',
  phoneCodeVerifyFailed: 'Wufa yanzheng yanzhengma',

  phoneChatsHeading: 'Liaotian',
  phoneTelegramLoginHeading: 'Telegram Denglu',
  phoneTelegramSessionHeading: 'Telegram Huihua',
  phoneNewTelegramHeading: 'Xin Telegram',
  phoneErrorHeading: 'Cuowu',
  phoneVerificationCode: 'Yanzhengma',
  phoneMobileNumber: 'Shoujihao yu guojia daima',
  phoneSend: 'Fasong',
  phoneVerifyCode: 'Yanzheng Yanzhengma',
  phoneSendLoginCode: 'Fasong Denglu Yanzhengma',
  phoneOpenThread: 'Dakai Xiancheng',
  phoneRetry: 'Chongshi',

  phoneSettingsHeading: 'Shezhi',
  phoneAlreadyConnected: 'Yi lianjie',
  phoneNotConnected: 'Wei lianjie',
  phoneConfigured: 'Yi peizhi',
  phoneRequired: 'Bixu',
  phoneStoredOnPhone: 'Jin cunchu zai ci shouji',
  phoneBackendSessionActive: 'Houtai huihua huoyue',
  phoneNotLoggedIn: 'Shangwei denglu',
  phoneSaveSettings: 'Baocun Shezhi',
  phoneSaved: 'Yi Baocun',
  phoneReset: 'Chongzhi',
  phoneDisconnectTelegram: 'Duankai Telegram',
  phoneDisconnecting: 'Duankai-zhong...',

  phoneAppTitle: 'TeleGlance',
  phoneSettingsTab: 'Shezhi',
  phoneBack: 'Fanhui',
  phoneBackToChat: 'Fanhui dao liaotian',
  phoneOpenSettings: 'Dakai shezhi',

  errorBackendUnreachable:
    'Wufa lianjie houtai. Zai Shezhi zhong tianxie Houtai URL bing quebao houtai fuwuqi zhengzai yunxing.',
  errorBackendTimeout:
    'Houtai qingqiu {seconds}miao hou chaoshi. Fuwuqi keneng wufa fangwen huo qia si. Qing chongshi huo jiancha houtai.',
  errorEncryptedAuthMissing:
    'Jiami renzheng xuyao TeleGlance Shezhi zhong de Houtai gongxiang miyao, Telegram API ID, he Telegram API hash.',
  errorSharedSecretRequired:
    'Xuyao Houtai gongxiang miyao lai jiemi houtai xiangying.',
  errorEncryptedMalformed: 'Jiami houtai xiangying geshi cuowu',
  errorWebCryptoRequired:
    'Jiami houtai renzheng xuyao WebCrypto. Qing shiyong dabaohou yingyong, localhost, HTTPS, huo zhichi WebCrypto de liulanqi.',
  errorUpdateStreamUnavailable: 'Gengxin liu buke yong',
  errorUpdateStreamFailed: 'Gengxin liu shibai',
  errorStarting: 'Qidong-zhong...',
  errorStartupFailed: 'Qidong shibai',
  errorUnexpected: 'Fasheng yichang cuowu',

  authNeedsSetup:
    'Dakai Shezhi, tianxie Houtai URL, Gongxiang Miyao, Telegram API ID, he Telegram API Hash. Ranhou chongxin qidong yingyong.',
  authSignedOut: 'Dianji shiyong shoujihao denglu.',
  authPhonePending: 'Shuru fasong dao nin shouji de yanzhengma.',

  bridgeEmptyList: 'Kong',
}

export default zh
