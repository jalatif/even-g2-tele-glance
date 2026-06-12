import { describe, expect, it } from 'vitest'
import en from '../src/locales/en'
import { getLocale, setLocale } from '../src/locales'

describe('locale modules', () => {
  it('en.ts has all required key categories', () => {
    const requiredSections = [
      'titleTelegram', 'titleTelegramLogin', 'titleTopics', 'titleChats',
      'titleNewTelegram', 'titleRecordingReply', 'titleRecording',
      'titleTranscribing', 'titleConfirmReply', 'titleSendingReply',
      'titleReplySent', 'titleError',
    ]
    for (const key of requiredSections) {
      expect(en[key]).toBeDefined()
      expect(typeof en[key]).toBe('string')
    }
  })

  it('en.ts has all status labels', () => {
    const required = [
      'statusSent', 'statusOlderMessages', 'statusNewerMessages',
      'statusNoOlderMessages', 'statusNewReply', 'statusLoadingOlderMessages',
      'statusLoadingMessages',
    ]
    for (const key of required) {
      expect(en[key]).toBeDefined()
    }
  })

  it('en.ts has all footer strings', () => {
    const required = [
      'footerSwipeChats', 'footerTapToOpenTopic', 'footerSwipeScroll',
      'footerClickStop', 'footerSwipeSelect', 'footerDoubleClickDismiss',
      'footerLoadingMessages',
    ]
    for (const key of required) {
      expect(en[key]).toBeDefined()
    }
  })

  it('en.ts has all body/content strings', () => {
    const required = [
      'bodyNewMessage', 'bodyClickToOpen', 'bodyPressToRetry',
      'bodyConvertingVoice', 'confirmSend', 'confirmCancel',
      'senderMe', 'senderUnknown', 'sanitizeRed', 'sanitizeYellow',
      'sanitizeGreen',
    ]
    for (const key of required) {
      expect(en[key]).toBeDefined()
    }
  })

  it('en.ts has all phone UI strings', () => {
    const required = [
      'phoneAppTitle', 'phoneScreenOff', 'phoneRecording', 'phoneTranscribing',
      'phoneConfirmOnGlasses', 'phoneSendingReply', 'phoneReplySent',
      'phoneNoMessages', 'phoneOpenChatToSend', 'phoneSendFailed',
      'phoneChatsHeading', 'phoneSettingsHeading',
    ]
    for (const key of required) {
      expect(en[key]).toBeDefined()
    }
  })

  it('en.ts has all error/auth strings', () => {
    const required = [
      'errorBackendUnreachable', 'errorStartupFailed', 'errorUnexpected',
      'authNeedsSetup', 'authSignedOut', 'authPhonePending',
    ]
    for (const key of required) {
      expect(en[key]).toBeDefined()
    }
  })

  it('setLocale updates getLocale', () => {
    const original = getLocale()
    // Create a minimal locale that satisfies the type
    const mock: typeof en = { ...en, titleTelegram: 'TestApp' }
    setLocale(mock)
    expect(getLocale().titleTelegram).toBe('TestApp')
    // Restore
    setLocale(original)
    expect(getLocale().titleTelegram).toBe('Telegram')
  })

  it('getLocale default returns English', () => {
    expect(getLocale()).toBe(en)
  })
})
