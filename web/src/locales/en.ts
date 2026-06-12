const en = {
  // ── Glasses display: screen titles ──
  titleTelegram: 'Telegram',
  titleTelegramLogin: 'Telegram Login',
  titleTopics: 'Topics',
  titleChats: 'Chats',
  titleNewTelegram: 'New Telegram',
  titleRecordingReply: 'Recording reply',
  titleRecording: 'Recording',
  titleTranscribing: 'Transcribing',
  titleConfirmReply: 'Confirm reply',
  titleSendingReply: 'Sending reply',
  titleReplySent: 'Reply sent',
  titleError: 'Error',

  // ── Glasses display: status pills / footer labels ──
  statusSent: 'Sent',
  statusOlderMessages: 'Older messages',
  statusNewerMessages: 'Newer messages',
  statusNoOlderMessages: 'No older messages',
  statusNewReply: 'New reply',
  statusLoadingOlderMessages: 'Loading older messages...',
  statusLoadingMessages: 'Loading messages...',
  footerSwipeChats: 'Swipe chats | Press open',
  footerTapToOpenTopic: 'TAP TO OPEN TOPIC',
  footerSwipeScroll: 'Swipe scroll | Click record | Double click back',
  footerClickStop: 'Click stop | Double click cancel',
  footerSwipeSelect: 'Swipe select | Press confirm',
  footerDoubleClickDismiss: 'Double click dismiss',
  footerLoadingMessages: 'Loading messages...',

  // ── Glasses display: content / labels ──
  bodyNewMessage: 'New message',
  bodyClickToOpen: 'Click to open.',
  bodyPressToRetry: 'Press to retry. Double press back.',
  bodyConvertingVoice: 'Converting voice...',
  confirmSend: 'Send',
  confirmCancel: 'Cancel',
  senderMe: 'Me',
  senderUnknown: 'Unknown',
  sanitizeRed: '[red]',
  sanitizeYellow: '[yellow]',
  sanitizeGreen: '[green]',

  // ── Phone UI: ChatScreen state descriptions ──
  phoneScreenOff: 'Glasses screen is off…',
  phoneRecording: 'Recording on glasses…',
  phoneTranscribing: 'Transcribing voice reply…',
  phoneConfirmOnGlasses: 'Confirm reply on glasses: ',
  phoneSendingReply: 'Sending reply…',
  phoneReplySent: 'Reply sent.',
  phoneNoMessages: 'No messages yet.',
  phoneOpenChatToSend: 'Open a chat or topic to send a reply.',
  phoneSendFailed: 'Send failed',
  phoneCodeSendFailed: 'Could not send code',
  phoneCodeVerifyFailed: 'Could not verify code',

  // ── Phone UI: ChatScreen headings / labels ──
  phoneChatsHeading: 'Chats',
  phoneTelegramLoginHeading: 'Telegram Login',
  phoneTelegramSessionHeading: 'Telegram Session',
  phoneNewTelegramHeading: 'New Telegram',
  phoneErrorHeading: 'Error',
  phoneVerificationCode: 'Verification code',
  phoneMobileNumber: 'Mobile number with country code',
  phoneSend: 'Send',
  phoneVerifyCode: 'Verify Code',
  phoneSendLoginCode: 'Send Login Code',
  phoneOpenThread: 'Open Thread',
  phoneRetry: 'Retry',

  // ── Phone UI: SettingsScreen ──
  phoneSettingsHeading: 'Settings',
  phoneAlreadyConnected: 'Already connected',
  phoneNotConnected: 'Not connected',
  phoneConfigured: 'Configured',
  phoneRequired: 'Required',
  phoneStoredOnPhone: 'Stored on this phone only',
  phoneBackendSessionActive: 'Backend session active',
  phoneNotLoggedIn: 'Not logged in yet',
  phoneSaveSettings: 'Save Settings',
  phoneSaved: 'Saved',
  phoneReset: 'Reset',
  phoneDisconnectTelegram: 'Disconnect Telegram',
  phoneDisconnecting: 'Disconnecting...',

  // ── Phone UI: App shell ──
  phoneAppTitle: 'TeleGlance',
  phoneSettingsTab: 'Settings',
  phoneBack: 'Back',
  phoneBackToChat: 'Back to chat',
  phoneOpenSettings: 'Open settings',

  // ── Error / auth messages (phone + glasses) ──
  errorBackendUnreachable:
    'Backend is not reachable. Fill Backend URL in Settings and make sure the backend server is running.',
  errorBackendTimeout:
    'Backend request timed out after {seconds}s. The server may be unreachable or stuck. Try again or check the backend.',
  errorEncryptedAuthMissing:
    'Encrypted auth requires Backend shared secret, Telegram API ID, and Telegram API hash in TeleGlance Settings.',
  errorSharedSecretRequired:
    'Backend shared secret is required to decrypt backend response.',
  errorEncryptedMalformed: 'Encrypted backend response is malformed',
  errorWebCryptoRequired:
    'Encrypted backend auth requires WebCrypto. Use the packaged app, localhost, HTTPS, or a browser with WebCrypto support.',
  errorUpdateStreamUnavailable: 'Update stream is unavailable',
  errorUpdateStreamFailed: 'Update stream failed',
  errorStarting: 'Starting...',
  errorStartupFailed: 'Startup failed',
  errorUnexpected: 'An unexpected error occurred',

  // ── Auth screen messages ──
  authNeedsSetup:
    'Open Settings and fill Backend URL, Shared Secret, Telegram API ID, and Telegram API Hash. Then restart the app.',
  authSignedOut: 'Tap to log in with your phone number.',
  authPhonePending: 'Enter the verification code sent to your phone.',

  // ── Bridge ──
  bridgeEmptyList: 'Empty',
} as const

export default en
export type LocaleStrings = typeof en
