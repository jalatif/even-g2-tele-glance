import en from './en'
import type { LocaleStrings } from './en'

const ms: LocaleStrings = {
  ...en,

  titleTelegram: 'Telegram',
  titleTelegramLogin: 'Log Masuk Telegram',
  titleTopics: 'Topik',
  titleChats: 'Sembang',
  titleNewTelegram: 'Telegram Baru',
  titleRecordingReply: 'Merakam balasan',
  titleRecording: 'Merakam',
  titleTranscribing: 'Mentranskripsi',
  titleConfirmReply: 'Sahkan balasan',
  titleSendingReply: 'Menghantar balasan',
  titleReplySent: 'Balasan dihantar',
  titleError: 'Ralat',

  statusSent: 'Dihantar',
  statusOlderMessages: 'Mesej lama',
  statusNewerMessages: 'Mesej baru',
  statusNoOlderMessages: 'Tiada mesej lama',
  statusNewReply: 'Balasan baru',
  statusLoadingOlderMessages: 'Memuat mesej lama...',
  statusLoadingMessages: 'Memuat mesej...',
  footerSwipeChats: 'Leret sembang | Tekan buka',
  footerTapToOpenTopic: 'KETIK UNTUK BUKA TOPIK',
  footerSwipeScroll: 'Leret skrol | Klik rakam | Klik dua undur',
  footerClickStop: 'Klik henti | Klik dua batal',
  footerSwipeSelect: 'Leret pilih | Tekan sahkan',
  footerDoubleClickDismiss: 'Klik dua tutup',
  footerLoadingMessages: 'Memuat mesej...',

  bodyNewMessage: 'Mesej baru',
  bodyClickToOpen: 'Klik untuk buka.',
  bodyPressToRetry: 'Tekan cuba lagi. Klik dua undur.',
  bodyConvertingVoice: 'Menukar suara...',

  senderMe: 'Saya',
  senderUnknown: 'Tidak dikenali',

  phoneScreenOff: 'Skrin cermin mata mati...',
  phoneRecording: 'Merakam di cermin mata...',
  phoneTranscribing: 'Mentranskripsi balasan suara...',
  phoneConfirmOnGlasses: 'Sahkan balasan di cermin mata: ',
  phoneSendingReply: 'Menghantar balasan...',
  phoneReplySent: 'Balasan dihantar.',
  phoneNoMessages: 'Tiada mesej.',
  phoneOpenChatToSend: 'Buka sembang atau topik untuk hantar balasan.',
  phoneSendFailed: 'Hantar gagal',
  phoneCodeSendFailed: 'Tidak dapat hantar kod',
  phoneCodeVerifyFailed: 'Tidak dapat sahkan kod',

  phoneChatsHeading: 'Sembang',
  phoneTelegramLoginHeading: 'Log Masuk Telegram',
  phoneTelegramSessionHeading: 'Sesi Telegram',
  phoneNewTelegramHeading: 'Telegram Baru',
  phoneErrorHeading: 'Ralat',
  phoneVerificationCode: 'Kod pengesahan',
  phoneMobileNumber: 'Nombor mudah alih dengan kod negara',
  phoneSend: 'Hantar',
  phoneVerifyCode: 'Sahkan Kod',
  phoneSendLoginCode: 'Hantar Kod Log Masuk',
  phoneOpenThread: 'Buka Thread',
  phoneRetry: 'Cuba Lagi',

  phoneSettingsHeading: 'Tetapan',
  phoneAlreadyConnected: 'Sudah bersambung',
  phoneNotConnected: 'Tidak bersambung',
  phoneConfigured: 'Dikonfigurasi',
  phoneRequired: 'Diperlukan',
  phoneStoredOnPhone: 'Disimpan di telefon ini sahaja',
  phoneBackendSessionActive: 'Sesi backend aktif',
  phoneNotLoggedIn: 'Belum log masuk',
  phoneSaveSettings: 'Simpan Tetapan',
  phoneSaved: 'Disimpan',
  phoneReset: 'Set Semula',
  phoneDisconnectTelegram: 'Putuskan Telegram',
  phoneDisconnecting: 'Memutuskan...',

  phoneAppTitle: 'TeleGlance',
  phoneSettingsTab: 'Tetapan',
  phoneBack: 'Undur',
  phoneBackToChat: 'Undur ke sembang',
  phoneOpenSettings: 'Buka tetapan',

  errorBackendUnreachable:
    'Backend tidak dapat dihubungi. Isi URL Backend di Tetapan dan pastikan pelayan backend berjalan.',
  errorBackendTimeout:
    'Permintaan backend tamat masa selepas {seconds}s. Pelayan mungkin tidak dapat dihubungi atau tersekat. Cuba lagi atau semak backend.',
  errorEncryptedAuthMissing:
    'Auth tersulit memerlukan Backend shared secret, Telegram API ID, dan Telegram API hash di Tetapan TeleGlance.',
  errorSharedSecretRequired:
    'Backend shared secret diperlukan untuk menyahsulit respons backend.',
  errorEncryptedMalformed: 'Respons backend tersulit rosak',
  errorWebCryptoRequired:
    'Auth backend tersulit memerlukan WebCrypto. Gunakan app terpasang, localhost, HTTPS, atau penyemak imbas dengan sokongan WebCrypto.',
  errorUpdateStreamUnavailable: 'Strim kemas kini tidak tersedia',
  errorUpdateStreamFailed: 'Strim kemas kini gagal',
  errorStarting: 'Bermula...',
  errorStartupFailed: 'Permulaan gagal',
  errorUnexpected: 'Ralat tidak dijangka berlaku',

  authNeedsSetup:
    'Buka Tetapan dan isi URL Backend, Shared Secret, Telegram API ID, dan Telegram API Hash. Kemudian mulakan semula app.',
  authSignedOut: 'Ketik untuk log masuk dengan nombor telefon anda.',
  authPhonePending: 'Masukkan kod pengesahan yang dihantar ke telefon anda.',

  bridgeEmptyList: 'Kosong',
}

export default ms
