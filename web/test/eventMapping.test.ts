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
        type: 'listEvent',
        data: { event_type: 'DOUBLE_PRESS', current_select_item_index: '1' },
      }),
    ).toEqual({ type: 'doublePress', index: 1 })
    expect(mapEvenHubEvent({ textEvent: { Event_Type: 'SWIPE_UP' } })).toEqual({ type: 'swipeUp' })
    expect(mapEvenHubEvent({ textEvent: { eventType: '2' } })).toEqual({ type: 'swipeDown' })
  })

  it('coalesces rapid clicks into double press instead of two presses', () => {
    vi.useFakeTimers()
    const onInput = vi.fn()
    const coalesce = createInputCoalescer(onInput, 250)

    coalesce({ type: 'press' })
    coalesce({ type: 'press' })
    vi.advanceTimersByTime(300)

    expect(onInput).toHaveBeenCalledTimes(1)
    expect(onInput).toHaveBeenCalledWith({ type: 'doublePress' })
    vi.useRealTimers()
  })

  it('emits a single press only after the double press window expires', () => {
    vi.useFakeTimers()
    const onInput = vi.fn()
    const coalesce = createInputCoalescer(onInput, 250)

    coalesce({ type: 'press' })
    expect(onInput).not.toHaveBeenCalled()
    vi.advanceTimersByTime(250)

    expect(onInput).toHaveBeenCalledTimes(1)
    expect(onInput).toHaveBeenCalledWith({ type: 'press' })
    vi.useRealTimers()
  })
})
