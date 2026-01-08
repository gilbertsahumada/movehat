module hello_blockchain::counter {
    use std::signer;

    /// Error code for counter overflow
    const E_OVERFLOW: u64 = 1;
    /// Maximum value for u64
    const U64_MAX: u64 = 18446744073709551615;

    struct Counter has key {
        value: u64
    }

    public entry fun increment(account: signer) acquires Counter {
        let addr = signer::address_of(&account);

        if (!exists<Counter>(addr)) {
            move_to(&account, Counter { value: 0 });
        };

        let counter = borrow_global_mut<Counter>(addr);
        assert!(counter.value < U64_MAX, E_OVERFLOW);
        counter.value = counter.value + 1;
    }

    #[view]
    public fun get(addr: address): u64 acquires Counter {
        if (!exists<Counter>(addr)) {
            0
        } else {
            borrow_global<Counter>(addr).value
        }
    }
}
