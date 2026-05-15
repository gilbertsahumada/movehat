// Minimal Move module used only to pre-warm the Movement CLI's
// AptosFramework dependency cache during Docker image build. Not shipped
// to users; not exercised at runtime.
module warm::warm {
    public fun nothing() {}
}
