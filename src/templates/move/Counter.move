module counter::counter {
    use std::signer;
    use aptos_framework::event;
    use aptos_framework::account;

    struct Counter has key {
        value: u64,
        increment_events: event::EventHandle<IncrementEvent>,
    }

    struct IncrementEvent has drop, store {
        old_value: u64,
        new_value: u64,
    }

    /// Initialize counter for an account
    public entry fun init(account: &signer) {
        let account_addr = signer::address_of(account);
        
        if (!exists<Counter>(account_addr)) {
            move_to(account, Counter {
                value: 0,
                increment_events: account::new_event_handle<IncrementEvent>(account),
            });
        }
    }

    /// Increment the counter
    public entry fun increment(account: &signer) acquires Counter {
        let account_addr = signer::address_of(account);
        assert!(exists<Counter>(account_addr), 1);
        
        let counter = borrow_global_mut<Counter>(account_addr);
        let old_value = counter.value;
        counter.value = old_value + 1;
        
        event::emit_event(&mut counter.increment_events, IncrementEvent {
            old_value,
            new_value: counter.value,
        });
    }

    /// Get counter value
    #[view]
    public fun get(addr: address): u64 acquires Counter {
        assert!(exists<Counter>(addr), 1);
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
}