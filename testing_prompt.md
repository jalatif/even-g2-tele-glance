I want to fix the testing harnessi (as defined in IMPLEMENTATION_TEST_PLAN.md) and make it fully through so I can validate invariants for all page transitions including
validating view on both left and right side is accurate and fully legible. Ok to use dummy data or pull data from my telegram chats for testing, pulling realtime
data from telegram can also help validate end-to-end latency but we can start with dummy data which is still being passed by backend even if not pulled from telegram ser
I also want us to catch performance issues if chat loading is taking more than a second. Also, data correctness is very important so correct messages are displayed.
Notification behavior, glasses turn off behavior, record send behavior etc all needs to be validated. Recording might not work because there's no microphone so you can
send fake data from STT server and click send/cancel double click to cancel behaviors.·

You should also think through all the invariants of UI screen and write them in md file, they all need to be validatated with simulator testing

example: first screen itself is wrong on glasses right now, it doesn't show
  list of chats on left side, loading messages is taking very long time even on
  simulator now. Scrolling should also show messages on chat on left side.
