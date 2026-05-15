script {
    // Minimal demonstration of `harness.runMoveScript`. Move scripts are
    // one-shot transactions that ship compiled bytecode inline rather
    // than installing a module on-chain. The CLI takes the .move source,
    // compiles it on the fly, and submits the resulting transaction.
    //
    // This script is intentionally inert (no module imports, no state
    // mutation) so the example doesn't depend on prior deployments. The
    // u64 argument exercises the typed-arg path of `runMoveScript`.
    fun echo(_account: signer, _value: u64) {}
}
