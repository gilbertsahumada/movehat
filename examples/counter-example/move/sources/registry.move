module hello_blockchain::registry {
    use std::signer;
    use std::error;
    use std::string::String;
    use aptos_framework::account;
    use aptos_framework::event;

    /// Account is already registered.
    const E_ALREADY_REGISTERED: u64 = 1;
    /// Account is not registered.
    const E_NOT_REGISTERED: u64 = 2;

    // Per-account identity record. Stored under the account that calls
    // `register`, so each address owns exactly one (or zero) Identity.
    struct Identity has key {
        name: String,
        register_events: event::EventHandle<RegisterEvent>,
    }

    // Event emitted on a successful `register` call.
    struct RegisterEvent has drop, store {
        owner: address,
        name: String,
    }

    // Register the caller with `name`. Aborts with `E_ALREADY_REGISTERED`
    // if the caller already has an Identity stored — registrations are
    // one-shot per account.
    public entry fun register(account: signer, name: String) {
        let owner = signer::address_of(&account);
        assert!(!exists<Identity>(owner), error::already_exists(E_ALREADY_REGISTERED));

        let identity = Identity {
            name: copy name,
            register_events: account::new_event_handle<RegisterEvent>(&account),
        };

        // `name` is still available here (we explicitly `copy`'d it into
        // the struct above) and identity.register_events is the only
        // outstanding borrow of the event handle, so the &mut borrow
        // for emit_event is allowed.
        event::emit_event(&mut identity.register_events, RegisterEvent {
            owner,
            name,
        });

        move_to(&account, identity);
    }

    // Look up the registered name for `addr`. Aborts with `E_NOT_REGISTERED`
    // if the address has no Identity. Use `is_registered` first if you
    // want a non-aborting check.
    #[view]
    public fun get_name(addr: address): String acquires Identity {
        assert!(exists<Identity>(addr), error::not_found(E_NOT_REGISTERED));
        borrow_global<Identity>(addr).name
    }

    // Non-aborting check: returns true if `addr` has an Identity stored.
    #[view]
    public fun is_registered(addr: address): bool {
        exists<Identity>(addr)
    }
}
