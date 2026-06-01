import { useEffect, useRef, useState } from 'react'
import { useApp } from '../contexts/AppContext'
import type { Message } from '../types'

export function ChatScreen() {
  const { state, sendText } = useApp()
  const [draft, setDraft] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const messageEndRef = useRef<HTMLDivElement | null>(null)

  const activeMessages = 'messages' in state ? state.messages : []
  const canSend = state.screen === 'messages' && draft.trim().length > 0 && !isSending

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: 'end' })
  }, [activeMessages.length, state.screen])

  async function handleSend() {
    const text = draft.trim()
    if (!text) return
    setIsSending(true)
    setSendError(null)
    try {
      await sendText(text)
      setDraft('')
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'Send failed')
    } finally {
      setIsSending(false)
    }
  }

  return (
    <main className="chat-screen">
      <section className="phone-panel message-panel">
        <PhoneStateView />
        {state.screen === 'messages' && (
          <div className="messages-list" aria-label="Messages">
            {state.messages.length === 0 ? (
              <p className="empty-text">No messages yet.</p>
            ) : state.messages.map((message) => <MessageBubble key={String(message.id)} message={message} />)}
            <div ref={messageEndRef} />
          </div>
        )}
      </section>
      {state.screen === 'messages' ? (
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault()
            void handleSend()
          }}
        >
          {sendError && <p className="field-error">{sendError}</p>}
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Type a Telegram reply..."
            disabled={isSending}
            rows={3}
          />
          <button type="submit" disabled={!canSend}>
            {isSending ? 'Sending...' : 'Send'}
          </button>
        </form>
      ) : (
        <div className="composer-banner">Open a chat or topic to send a reply.</div>
      )}
      <PhoneActions />
    </main>
  )
}

function PhoneStateView() {
  const { state, dispatch } = useApp()
  if (state.screen === 'auth') {
    return (
      <div className="stack">
        <h2>{state.mode === 'qrPending' ? 'Telegram Login' : 'Telegram Session'}</h2>
        <p>{state.message}</p>
        {state.qrUrl && <code>{state.qrUrl}</code>}
        <button type="button" onClick={() => void dispatch({ type: 'press' })}>
          {state.mode === 'qrPending' ? 'Check Login' : 'Start QR Login'}
        </button>
      </div>
    )
  }
  if (state.screen === 'chats') {
    return (
      <div className="stack">
        <h2>Chats</h2>
        <div className="select-list">
          {state.chats.map((chat, index) => (
            <button key={String(chat.id)} type="button" className={index === state.selectedIndex ? 'selected' : ''} onClick={() => void dispatch({ type: 'press', index })}>
              <span>{chat.title}</span>
              {chat.unreadCount ? <strong>{chat.unreadCount}</strong> : null}
            </button>
          ))}
        </div>
      </div>
    )
  }
  if (state.screen === 'topics') {
    return (
      <div className="stack">
        <h2>{state.chat.title}</h2>
        <div className="select-list">
          {state.topics.map((topic, index) => (
            <button key={String(topic.id)} type="button" className={index === state.selectedIndex ? 'selected' : ''} onClick={() => void dispatch({ type: 'press', index })}>
              <span>{topic.title}</span>
              {topic.unreadCount ? <strong>{topic.unreadCount}</strong> : null}
            </button>
          ))}
        </div>
      </div>
    )
  }
  if (state.screen === 'messages') {
    return (
      <div className="thread-heading">
        <div>
          <h2>{state.topic ? state.topic.title : state.chat.title}</h2>
          <p>{state.topic ? state.chat.title : 'Current thread'}</p>
        </div>
        {state.status && <span className="status-pill">{state.status}</span>}
      </div>
    )
  }
  if (state.screen === 'newMessage') {
    return (
      <div className="stack">
        <h2>New Telegram</h2>
        <p>{state.topic ? `${state.chat.title} / ${state.topic.title}` : state.chat.title}</p>
        <blockquote>{state.message || 'New message'}</blockquote>
        <button type="button" onClick={() => void dispatch({ type: 'press' })}>Open Thread</button>
      </div>
    )
  }
  if (state.screen === 'asleep') return <p className="empty-text">Glasses screen is off. Double-click glasses to wake.</p>
  if (state.screen === 'loading') return <p className="empty-text">{state.message}</p>
  if (state.screen === 'recording') return <p className="empty-text">Recording on glasses...</p>
  if (state.screen === 'transcribing') return <p className="empty-text">Transcribing voice reply...</p>
  if (state.screen === 'confirm') return <p className="empty-text">Confirm reply on glasses: {state.transcript}</p>
  if (state.screen === 'sending') return <p className="empty-text">Sending reply...</p>
  if (state.screen === 'sent') return <p className="empty-text">Reply sent.</p>
  return (
    <div className="stack">
      <h2>Error</h2>
      <p>{state.message}</p>
      <button type="button" onClick={() => void dispatch({ type: 'press' })}>Retry</button>
    </div>
  )
}

function PhoneActions() {
  const { state, dispatch } = useApp()
  return (
    <nav className="phone-actions" aria-label="Phone actions">
      <button type="button" onClick={() => void dispatch({ type: 'swipeUp' })} disabled={state.screen !== 'messages' && state.screen !== 'chats' && state.screen !== 'topics'}>
        Older / Up
      </button>
      <button type="button" onClick={() => void dispatch({ type: 'swipeDown' })} disabled={state.screen !== 'messages' && state.screen !== 'chats' && state.screen !== 'topics'}>
        Newer / Down
      </button>
      <button type="button" onClick={() => void dispatch({ type: 'doublePress' })}>
        Back / Sleep
      </button>
    </nav>
  )
}

function MessageBubble({ message }: { message: Message }) {
  return (
    <article className={`message-bubble ${message.outgoing ? 'outgoing' : 'incoming'}`}>
      <header>{message.outgoing ? 'Me' : message.sender || 'Unknown'}</header>
      <p>{message.text}</p>
    </article>
  )
}
