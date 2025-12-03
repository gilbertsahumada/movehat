module deployer::counter {
    use std::signer;

    struct Counter has key {
        value: u64,
    }

    public fun init(account: &signer) {
        move_to(account, Counter { value: 0 });
    }

    public fun increment(account: &signer, amount: u64) {
        let counter = borrow_global_mut<Counter>(signer::address_of(account));
        counter.value = counter.value + amount;
    }

    public fun get(account: &signer): u64 {
        let counter = borrow_global<Counter>(signer::address_of(account));
        counter.value
    }
}