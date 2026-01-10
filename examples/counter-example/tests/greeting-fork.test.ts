import { describe, it, before } from "mocha";
import { expect } from "chai";
import { setupTestFixture, teardownTestFixture, type TestFixture } from "movehat/helpers";

/**
 * Este test demuestra cómo usar un FORK de testnet con un contrato YA DESPLEGADO
 *
 * REQUISITOS PREVIOS:
 * 1. Tener fondos en testnet (usa el faucet: https://faucet.movementnetwork.xyz/)
 * 2. Configurar PRIVATE_KEY en .env
 * 3. Desplegar el contrato a testnet:
 *    $ npx movehat run scripts/deploy-greeting.ts --network testnet
 * 4. Crear un fork DESPUÉS del deployment:
 *    $ npx movehat fork create --network testnet --name greeting-testnet
 * 5. Ejecutar este test:
 *    $ npx mocha --require tsx tests/greeting-fork.test.ts
 *
 * VENTAJAS del testing con Fork:
 * - Usa estado REAL de la red (contratos desplegados, balances, etc.)
 * - Sin costo de gas (todo es local)
 * - Puedes modificar el estado sin afectar la red real
 * - Perfecto para testing de integración con contratos existentes
 */
describe("Greeting Contract - Fork Testing", () => {
  let fixture: TestFixture<'greeting'>;

  before(async function () {
    this.timeout(90000);

    // IMPORTANTE: Usa mode: 'fork' y especifica el nombre del fork
    // Este fork debe existir (creado previamente con fork create)
    fixture = await setupTestFixture(
      ['greeting'] as const,
      ['alice', 'bob'],
      {
        mode: 'fork',
        forkName: 'greeting-testnet' // Nombre del fork que creaste
      }
    );

    console.log(`\n✅ Testing with Fork of Testnet`);
    console.log(`   Fork: greeting-testnet`);
    console.log(`   Deployer: ${fixture.accounts.deployer.accountAddress.toString()}`);
    console.log(`   Alice: ${fixture.accounts.alice.accountAddress.toString()}\n`);
  });

  it("should read greeting from deployed contract", async () => {
    const greeting = fixture.contracts.greeting;
    const deployer = fixture.accounts.deployer;

    // Leer el greeting que fue establecido durante el deployment
    const greetingText = await greeting.view<string>("get_greeting", [
      deployer.accountAddress.toString()
    ]);

    console.log(`   Greeting from testnet: "${greetingText}"`);

    // El greeting debe existir porque ya fue desplegado e inicializado
    expect(greetingText).to.be.a('string');
    expect(greetingText.length).to.be.greaterThan(0);
  });

  it("alice can interact with deployed contract in fork", async () => {
    const greeting = fixture.contracts.greeting;
    const alice = fixture.accounts.alice;

    // En el fork, Alice puede hacer transacciones sin gastar gas real
    const tx = await greeting.call(alice, "set_greeting", ["Hello from Fork!"]);
    console.log(`   Alice's transaction (in fork): ${tx.hash}`);

    // Verificar que el greeting se actualizó en el fork
    const aliceGreeting = await greeting.view<string>("get_greeting", [
      alice.accountAddress.toString()
    ]);

    console.log(`   Alice's greeting: "${aliceGreeting}"`);
    expect(aliceGreeting).to.equal("Hello from Fork!");
  });

  it("should return correct module address from deployed contract", async () => {
    const greeting = fixture.contracts.greeting;

    const moduleAddress = await greeting.view<string>("get_module_address", []);
    console.log(`   Module address: ${moduleAddress}`);

    // La dirección del módulo debe ser la del deployer original
    expect(moduleAddress).to.equal(fixture.accounts.deployer.accountAddress.toString());
  });

  after(async () => {
    await teardownTestFixture();
  });
});
