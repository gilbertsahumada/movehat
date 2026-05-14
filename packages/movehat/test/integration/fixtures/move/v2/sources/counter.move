module integration_counter::counter {
    struct Counter has key {
        value: u64,
    }

    fun init_module(account: &signer) {
        move_to(account, Counter { value: 0 });
    }

    public entry fun increment(_caller: &signer) acquires Counter {
        let counter = borrow_global_mut<Counter>(@integration_counter);
        counter.value = counter.value + 1;
    }

    public entry fun reset(_caller: &signer) acquires Counter {
        let counter = borrow_global_mut<Counter>(@integration_counter);
        counter.value = 0;
    }

    #[view]
    public fun get(): u64 acquires Counter {
        borrow_global<Counter>(@integration_counter).value
    }
}
