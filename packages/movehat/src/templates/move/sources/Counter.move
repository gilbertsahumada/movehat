module counter::counter {
    use std::signer;
    use aptos_framework::event;
    use aptos_framework::account;

    /// Error code for counter overflow
    const E_OVERFLOW: u64 = 1;
    /// Error code for counter not initialized
    const E_NOT_INITIALIZED: u64 = 2;
    /// Maximum value for u64
    const U64_MAX: u64 = 18446744073709551615;

    struct Counter has key {
        value: u64,
        increment_events: event::EventHandle<IncrementEvent>,
    }

    struct IncrementEvent has drop, store {
        old_value: u64,
        new_value: u64,
    }

    public entry fun init(account: &signer) {
        let account_addr = signer::address_of(account);
        
        if (!exists<Counter>(account_addr)) {
            move_to(account, Counter {
                value: 0,
                increment_events: account::new_event_handle<IncrementEvent>(account),
            });
        }
    }

    public entry fun increment(account: &signer) acquires Counter {
        let account_addr = signer::address_of(account);

        // Auto-init: create Counter if it doesn't exist yet. Defense in
        // depth so the module stays usable even if a caller skips the
        // dedicated `init` entry function.
        if (!exists<Counter>(account_addr)) {
            move_to(account, Counter {
                value: 0,
                increment_events: account::new_event_handle<IncrementEvent>(account),
            });
        };

        let counter = borrow_global_mut<Counter>(account_addr);
        let old_value = counter.value;
        assert!(old_value < U64_MAX, E_OVERFLOW);
        counter.value = old_value + 1;

        event::emit_event(&mut counter.increment_events, IncrementEvent {
            old_value,
            new_value: counter.value,
        });
    }

    #[view]
    public fun get(addr: address): u64 acquires Counter {
        assert!(exists<Counter>(addr), E_NOT_INITIALIZED);
        borrow_global<Counter>(addr).value
    }

    #[test(account = @0x1)]
    public fun test_increment(account: &signer) acquires Counter {
        let addr = signer::address_of(account);
        aptos_framework::account::create_account_for_test(addr);

        init(account);
        assert!(get(addr) == 0, 0);

        increment(account);
        assert!(get(addr) == 1, 1);

        increment(account);
        assert!(get(addr) == 2, 2);
    }

    /// Regression guard: increment must auto-create the Counter resource
    /// when called against a never-initialized account. Locks the
    /// defense-in-depth behavior so a future refactor can't accidentally
    /// remove it.
    #[test(account = @0x2)]
    public fun test_increment_auto_inits(account: &signer) acquires Counter {
        let addr = signer::address_of(account);
        aptos_framework::account::create_account_for_test(addr);

        // Skip init entirely — increment must create the resource.
        increment(account);
        assert!(get(addr) == 1, 0);

        // Idempotent: a second increment uses the now-existing resource.
        increment(account);
        assert!(get(addr) == 2, 1);
    }
}