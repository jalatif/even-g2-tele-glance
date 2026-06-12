import en from './en'
import type { LocaleStrings } from './en'

const fr: LocaleStrings = {
  ...en,
  // ── Glasses display: screen titles ──
  titleTelegram: 'Telegram',
  titleTelegramLogin: 'Connexion Telegram',
  titleTopics: 'Sujets',
  titleChats: 'Chats',
  titleNewTelegram: 'Nouveau Telegram',
  titleRecordingReply: 'Enregistrement réponse',
  titleRecording: 'Enregistrement',
  titleTranscribing: 'Transcription',
  titleConfirmReply: 'Confirmer réponse',
  titleSendingReply: 'Envoi réponse',
  titleReplySent: 'Réponse envoyée',
  titleError: 'Erreur',

  // ── Glasses display: status pills / footer labels ──
  statusSent: 'Envoyé',
  statusOlderMessages: 'Plus anciens',
  statusNewerMessages: 'Plus récents',
  statusNoOlderMessages: 'Pas plus de messages',
  statusNewReply: 'Nouvelle réponse',
  statusLoadingOlderMessages: 'Chargement plus anciens...',
  statusLoadingMessages: 'Chargement messages...',
  footerSwipeChats: 'Glisser chats | Toucher ouvrir',
  footerTapToOpenTopic: 'TOUCHER POUR OUVRIR',
  footerSwipeScroll: 'Glisser | Toucher enreg. | Double toucher retour',
  footerClickStop: 'Toucher arrêter | Double toucher annuler',
  footerSwipeSelect: 'Glisser sélect. | Toucher confirmer',
  footerDoubleClickDismiss: 'Double toucher pour fermer',
  footerLoadingMessages: 'Chargement messages...',

  // ── Glasses display: content / labels ──
  bodyNewMessage: 'Nouveau message',
  bodyClickToOpen: 'Toucher pour ouvrir.',
  bodyPressToRetry: 'Toucher pour réessayer. Double toucher retour.',
  bodyConvertingVoice: 'Conversion voix...',
  confirmSend: 'Envoyer',
  confirmCancel: 'Annuler',
  senderMe: 'Moi',
  senderUnknown: 'Inconnu',
  sanitizeRed: '[rouge]',
  sanitizeYellow: '[jaune]',
  sanitizeGreen: '[vert]',

  // ── Phone UI: ChatScreen ──
  phoneScreenOff: 'Écran lunettes éteint…',
  phoneRecording: 'Enregistrement sur lunettes…',
  phoneTranscribing: 'Transcription réponse vocale…',
  phoneConfirmOnGlasses: 'Confirmer réponse sur lunettes: ',
  phoneSendingReply: 'Envoi réponse…',
  phoneReplySent: 'Réponse envoyée.',
  phoneNoMessages: 'Pas encore de messages.',
  phoneOpenChatToSend: 'Ouvrir un chat pour envoyer une réponse.',
  phoneSendFailed: 'Échec envoi',
  phoneCodeSendFailed: 'Échec envoi code',
  phoneCodeVerifyFailed: 'Échec vérification code',
  phoneChatsHeading: 'Chats',
  phoneTelegramLoginHeading: 'Connexion Telegram',
  phoneSend: 'Envoyer',
  phoneVerifyCode: 'Vérifier Code',
  phoneSendLoginCode: 'Envoyer Code',
  phoneOpenThread: 'Ouvrir Fil',
  phoneRetry: 'Réessayer',

  // ── Settings ──
  phoneSettingsHeading: 'Paramètres',
  phoneAlreadyConnected: 'Déjà connecté',
  phoneNotConnected: 'Non connecté',
  phoneConfigured: 'Configuré',
  phoneRequired: 'Requis',
  phoneSaveSettings: 'Enregistrer Paramètres',
  phoneSaved: 'Enregistré',
  phoneReset: 'Réinitialiser',
  phoneDisconnectTelegram: 'Déconnecter Telegram',
  phoneDisconnecting: 'Déconnexion...',

  // ── App shell ──
  phoneAppTitle: 'TeleGlance',
  phoneSettingsTab: 'Paramètres',
  phoneBack: 'Retour',
  phoneBackToChat: 'Retour au chat',
  phoneOpenSettings: 'Ouvrir paramètres',

  // ── Error / auth ──
  authSignedOut: 'Touchez pour vous connecter avec votre numéro.',
  authPhonePending: 'Entrez le code de vérification envoyé à votre téléphone.',
}
export default fr
