module hello_blockchain::counter {
    use std::signer;

    struct Counter has key {
        value: u64
    }

    public entry fun increment(account: signer) acquires Counter {
        let addr = signer::address_of(&account);

        if (!exists<Counter>(addr)) {
            move_to(&account, Counter { value: 1 });
        } else {
            let counter = borrow_global_mut<Counter>(addr);
            counter.value = counter.value + 1;
        }
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
