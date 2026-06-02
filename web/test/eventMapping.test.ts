import { describe, expect, it, vi } from 'vitest'
import { createInputCoalescer, mapEvenHubEvent } from '../src/bridge/eventMapping'

describe('mapEvenHubEvent', () => {
  it('maps press, double press, and swipes from text events', () => {
    expect(mapEvenHubEvent({ textEvent: { eventType: undefined } })).toEqual({ type: 'press' })
    expect(mapEvenHubEvent({ textEvent: { eventType: 3 } })).toEqual({ type: 'doublePress' })
    expect(mapEvenHubEvent({ textEvent: { eventType: 'DOUBLE_CLICK_EVENT' } })).toEqual({ type: 'doublePress' })
    expect(mapEvenHubEvent({ textEvent: { eventType: 1 } })).toEqual({ type: 'swipeUp' })
    expect(mapEvenHubEvent({ textEvent: { eventType: 2 } })).toEqual({ type: 'swipeDown' })
  })

  it('maps list selection and audio chunks', () => {
    expect(mapEvenHubEvent({ listEvent: { currentSelectItemIndex: 2 } })).toEqual({ type: 'selectIndex', index: 2 })
    expect(mapEvenHubEvent({ listEvent: { eventType: 0, currentSelectItemIndex: 2 } })).toEqual({ type: 'press', index: 2 })
    expect(mapEvenHubEvent({ listEvent: { eventType: 3, currentSelectItemIndex: 2 } })).toEqual({ type: 'doublePress', index: 2 })
    expect(mapEvenHubEvent({ listEvent: { currentSelectItemName: 'Project' } })).toEqual({ type: 'selectIndex', itemName: 'Project' })
    expect(mapEvenHubEvent({ listEvent: { eventType: 0, currentSelectItemName: 'Project' } })).toEqual({ type: 'press', itemName: 'Project' })
    expect(mapEvenHubEvent({ audioEvent: { audioPcm: [1, 2, 3] } })).toEqual({
      type: 'audioChunk',
      pcm: new Uint8Array([1, 2, 3]),
    })
  })

  it('maps raw hardware/protobuf-shaped event payloads', () => {
    expect(
      mapEvenHubEvent({
        type: 'list_event',
        jsonData: { Event_Type: 'PRESS', CurrentSelect_ItemIndex: '3' },
      }),
    ).toEqual({ type: 'press', index: 3 })
    expect(
      mapEvenHubEvent({
        type: 'list_event',
        jsonData: { Event_Type: 'PRESS', CurrentSelect_ItemName: 'Project' },
      }),
    ).toEqual({ type: 'press', itemName: 'Project' })
    expect(
      mapEvenHubEvent({
        type: 'listEvent',
        data: { event_type: 'DOUBLE_PRESS', current_select_item_index: '1' },
      }),
    ).toEqual({ type: 'doublePress', index: 1 })
    expect(mapEvenHubEvent({ textEvent: { Event_Type: 'SWIPE_UP' } })).toEqual({ type: 'swipeUp' })
    expect(mapEvenHubEvent({ textEvent: { eventType: '2' } })).toEqual({ type: 'swipeDown' })
  })

  it('maps gesture event types from system events like even-toolkit', () => {
    expect(mapEvenHubEvent({ sysEvent: { eventType: 0 } })).toEqual({ type: 'press' })
    expect(mapEvenHubEvent({ sysEvent: { eventType: 3 } })).toEqual({ type: 'doublePress' })
    expect(mapEvenHubEvent({ sysEvent: { eventType: 1 } })).toEqual({ type: 'swipeUp' })
    expect(mapEvenHubEvent({ sysEvent: { eventType: 2 } })).toEqual({ type: 'swipeDown' })
  })

  it('keeps raw jsonData eventType when SDK-normalized sysEvent omits it', () => {
    expect(
      mapEvenHubEvent({
        jsonData: { eventType: 3, eventSource: 2 },
        sysEvent: { eventSource: 2 },
      }),
    ).toEqual({ type: 'doublePress' })
  })

  it('debounces duplicate click payloads instead of synthesizing double press', () => {
    vi.useFakeTimers()
    const onInput = vi.fn()
    const coalesce = createInputCoalescer(onInput, 250)

    coalesce({ type: 'press' })
    coalesce({ type: 'press' })

    expect(onInput).toHaveBeenCalledTimes(1)
    expect(onInput).toHaveBeenCalledWith({ type: 'press' })
    vi.useRealTimers()
  })

  it('emits a single press immediately', () => {
    vi.useFakeTimers()
    const onInput = vi.fn()
    const coalesce = createInputCoalescer(onInput, 250)

    coalesce({ type: 'press' })

    expect(onInput).toHaveBeenCalledTimes(1)
    expect(onInput).toHaveBeenCalledWith({ type: 'press' })
    vi.useRealTimers()
  })

  it('allows a native double press shortly after a press payload', () => {
    vi.useFakeTimers()
    const onInput = vi.fn()
    const coalesce = createInputCoalescer(onInput, 90, 220)

    coalesce({ type: 'press' })
    vi.advanceTimersByTime(80)
    coalesce({ type: 'doublePress' })

    expect(onInput).toHaveBeenCalledTimes(2)
    expect(onInput).toHaveBeenNthCalledWith(1, { type: 'press' })
    expect(onInput).toHaveBeenNthCalledWith(2, { type: 'doublePress' })
    vi.useRealTimers()
  })

  it('debounces duplicate same-direction swipe bursts', () => {
    vi.useFakeTimers()
    const onInput = vi.fn()
    const coalesce = createInputCoalescer(onInput, 90, 220, 250)

    coalesce({ type: 'swipeUp' })
    coalesce({ type: 'swipeUp' })
    coalesce({ type: 'swipeDown' })
    vi.advanceTimersByTime(251)
    coalesce({ type: 'swipeUp' })

    expect(onInput).toHaveBeenCalledTimes(3)
    expect(onInput).toHaveBeenNthCalledWith(1, { type: 'swipeUp' })
    expect(onInput).toHaveBeenNthCalledWith(2, { type: 'swipeDown' })
    expect(onInput).toHaveBeenNthCalledWith(3, { type: 'swipeUp' })
    vi.useRealTimers()
  })

  it('keeps normal repeated same-direction swipes with the default debounce', () => {
    vi.useFakeTimers()
    const onInput = vi.fn()
    const coalesce = createInputCoalescer(onInput)

    coalesce({ type: 'swipeDown' })
    vi.advanceTimersByTime(50)
    coalesce({ type: 'swipeDown' })

    expect(onInput).toHaveBeenCalledTimes(2)
    expect(onInput).toHaveBeenNthCalledWith(1, { type: 'swipeDown' })
    expect(onInput).toHaveBeenNthCalledWith(2, { type: 'swipeDown' })
    vi.useRealTimers()
  })
})
