module hello_blockchain::greeting {
    use std::string::String;
    use std::signer;
    use aptos_framework::account;
    use aptos_framework::event;

    /// Struct to hold greeting data
    struct GreetingHolder has key {
        greeting: String,
        count: u64,
        greeting_change_events: event::EventHandle<GreetingChangeEvent>,
    }

    /// Event emitted when greeting changes
    struct GreetingChangeEvent has drop, store {
        old_greeting: String,
        new_greeting: String,
        count: u64,
    }

    /// Error codes
    const ENO_GREETING: u64 = 1;

    /// View function to get the module address
    #[view]
    public fun get_module_address(): address {
        @hello_blockchain
    }

    /// View function to get greeting for an address
    #[view]
    public fun get_greeting(addr: address): String acquires GreetingHolder {
        assert!(exists<GreetingHolder>(addr), ENO_GREETING);
        borrow_global<GreetingHolder>(addr).greeting
    }

    /// View function to get greeting count
    #[view]
    public fun get_count(addr: address): u64 acquires GreetingHolder {
        assert!(exists<GreetingHolder>(addr), ENO_GREETING);
        borrow_global<GreetingHolder>(addr).count
    }

    /// Entry function to set or update greeting
    public entry fun set_greeting(account: signer, new_greeting: String) acquires GreetingHolder {
        let account_addr = signer::address_of(&account);

        if (!exists<GreetingHolder>(account_addr)) {
            // First time setting greeting
            move_to(&account, GreetingHolder {
                greeting: new_greeting,
                count: 1,
                greeting_change_events: account::new_event_handle<GreetingChangeEvent>(&account),
            });
        } else {
            // Update existing greeting
            let holder = borrow_global_mut<GreetingHolder>(account_addr);
            let old_greeting = holder.greeting;
            holder.count = holder.count + 1;

            event::emit_event(&mut holder.greeting_change_events, GreetingChangeEvent {
                old_greeting,
                new_greeting: copy new_greeting,
                count: holder.count,
            });

            holder.greeting = new_greeting;
        }
    }

    #[test(account = @0x1)]
    public entry fun test_set_greeting(account: signer) acquires GreetingHolder {
        let addr = signer::address_of(&account);
        aptos_framework::account::create_account_for_test(addr);

        // Set initial greeting
        set_greeting(account, std::string::utf8(b"Hello, World!"));
        assert!(get_greeting(addr) == std::string::utf8(b"Hello, World!"), 0);
        assert!(get_count(addr) == 1, 1);
    }

    #[test(account1 = @0x1, account2 = @0x2)]
    public entry fun test_update_greeting(account1: signer, account2: signer) acquires GreetingHolder {
        let addr = signer::address_of(&account1);
        aptos_framework::account::create_account_for_test(addr);

        // Set initial greeting with first account
        set_greeting(account1, std::string::utf8(b"Hello"));
        assert!(get_count(addr) == 1, 0);

        // Create second account and update greeting from same account using account2
        let addr2 = signer::address_of(&account2);
        aptos_framework::account::create_account_for_test(addr2);
        set_greeting(account2, std::string::utf8(b"Goodbye"));
        assert!(get_greeting(addr2) == std::string::utf8(b"Goodbye"), 1);
        assert!(get_count(addr2) == 1, 2);
    }

    #[test]
    public fun test_module_address() {
        assert!(get_module_address() == @hello_blockchain, 0);
    }
}
