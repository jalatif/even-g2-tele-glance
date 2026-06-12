import en from './en'
import type { LocaleStrings } from './en'

const es: LocaleStrings = {
  ...en,
  // ── Glasses display: screen titles ──
  titleTelegram: 'Telegram',
  titleTelegramLogin: 'Inicio de Telegram',
  titleTopics: 'Temas',
  titleChats: 'Chats',
  titleNewTelegram: 'Nuevo Telegram',
  titleRecordingReply: 'Grabando respuesta',
  titleRecording: 'Grabando',
  titleTranscribing: 'Transcribiendo',
  titleConfirmReply: 'Confirmar respuesta',
  titleSendingReply: 'Enviando respuesta',
  titleReplySent: 'Respuesta enviada',
  titleError: 'Error',

  // ── Glasses display: status pills / footer labels ──
  statusSent: 'Enviado',
  statusOlderMessages: 'Más antiguos',
  statusNewerMessages: 'Más recientes',
  statusNoOlderMessages: 'Sin más mensajes',
  statusNewReply: 'Nueva respuesta',
  statusLoadingOlderMessages: 'Cargando más antiguos...',
  statusLoadingMessages: 'Cargando mensajes...',
  footerSwipeChats: 'Deslizar chats | Tocar para abrir',
  footerTapToOpenTopic: 'TOCAR PARA ABRIR TEMA',
  footerSwipeScroll: 'Deslizar | Tocar grabar | Doble toque atrás',
  footerClickStop: 'Tocar parar | Doble toque cancelar',
  footerSwipeSelect: 'Deslizar seleccionar | Tocar confirmar',
  footerDoubleClickDismiss: 'Doble toque para cerrar',
  footerLoadingMessages: 'Cargando mensajes...',

  // ── Glasses display: content / labels ──
  bodyNewMessage: 'Nuevo mensaje',
  bodyClickToOpen: 'Tocar para abrir.',
  bodyPressToRetry: 'Tocar para reintentar. Doble toque atrás.',
  bodyConvertingVoice: 'Convirtiendo voz...',
  confirmSend: 'Enviar',
  confirmCancel: 'Cancelar',
  senderMe: 'Yo',
  senderUnknown: 'Desconocido',
  sanitizeRed: '[rojo]',
  sanitizeYellow: '[amarillo]',
  sanitizeGreen: '[verde]',

  // ── Phone UI: ChatScreen ──
  phoneScreenOff: 'Pantalla de gafas apagada…',
  phoneRecording: 'Grabando en las gafas…',
  phoneTranscribing: 'Transcribiendo respuesta de voz…',
  phoneConfirmOnGlasses: 'Confirmar respuesta en gafas: ',
  phoneSendingReply: 'Enviando respuesta…',
  phoneReplySent: 'Respuesta enviada.',
  phoneNoMessages: 'Sin mensajes aún.',
  phoneOpenChatToSend: 'Abre un chat o tema para enviar una respuesta.',
  phoneSendFailed: 'Envío fallido',
  phoneCodeSendFailed: 'No se pudo enviar el código',
  phoneCodeVerifyFailed: 'No se pudo verificar el código',
  phoneChatsHeading: 'Chats',
  phoneTelegramLoginHeading: 'Inicio de Telegram',
  phoneSend: 'Enviar',
  phoneVerifyCode: 'Verificar Código',
  phoneSendLoginCode: 'Enviar Código',
  phoneOpenThread: 'Abrir Hilo',
  phoneRetry: 'Reintentar',

  // ── Settings ──
  phoneSettingsHeading: 'Ajustes',
  phoneAlreadyConnected: 'Ya conectado',
  phoneNotConnected: 'No conectado',
  phoneConfigured: 'Configurado',
  phoneRequired: 'Requerido',
  phoneSaveSettings: 'Guardar Ajustes',
  phoneSaved: 'Guardado',
  phoneReset: 'Restablecer',
  phoneDisconnectTelegram: 'Desconectar Telegram',
  phoneDisconnecting: 'Desconectando...',

  // ── App shell ──
  phoneAppTitle: 'TeleGlance',
  phoneSettingsTab: 'Ajustes',
  phoneBack: 'Atrás',
  phoneBackToChat: 'Volver al chat',
  phoneOpenSettings: 'Abrir ajustes',

  // ── Error / auth ──
  authSignedOut: 'Toca para iniciar sesión con tu número de teléfono.',
  authPhonePending: 'Introduce el código de verificación enviado a tu teléfono.',
}
export default es
