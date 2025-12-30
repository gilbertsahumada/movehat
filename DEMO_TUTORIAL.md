# MoveHat Demo Tutorial - Video Script

> **Guion para demostración en video de MoveHat CLI**
> Hackathon Demo - Paso a paso completo

---

## 🎬 Introducción (30 segundos)

**[Mostrar pantalla en blanco o terminal limpio]**

**NARRACIÓN:**
> "Hola! Hoy voy a mostrarte MoveHat, un framework de desarrollo para smart contracts de Movement Network, inspirado en Hardhat. Con MoveHat puedes escribir, compilar y probar tus contratos Move usando TypeScript, todo sin configuración complicada."

---

## 📦 Parte 1: Instalación (1 minuto)

**[Terminal limpio]**

**NARRACIÓN:**
> "Primero, instalemos MoveHat globalmente usando npm o yarn."

### Comando 1: Instalar MoveHat
```bash
npm install -g movehat
# o
yarn global add movehat
```

**[Esperar a que termine la instalación]**

### Comando 2: Verificar instalación
```bash
movehat --version
```

**NARRACIÓN:**
> "Perfecto, MoveHat está instalado correctamente."

---

## 🚀 Parte 2: Crear Proyecto (1 minuto)

**[Terminal limpio]**

**NARRACIÓN:**
> "Ahora vamos a crear nuestro primer proyecto con MoveHat."

### Comando 3: Inicializar proyecto
```bash
movehat init hello-movement
```

**[Mostrar el output del comando con la estructura del proyecto]**

**NARRACIÓN:**
> "MoveHat nos crea una estructura completa con:
> - Carpeta 'move' para nuestros contratos
> - Carpeta 'tests' para tests de TypeScript
> - Y toda la configuración necesaria ya lista."

### Comando 4: Entrar al proyecto
```bash
cd hello-movement
```

### Comando 5: Instalar dependencias
```bash
npm install
```

**[Esperar instalación]**

---

## 📝 Parte 3: Preparar el Contrato (2 minutos)

**[Abrir editor de código - VS Code o similar]**

**NARRACIÓN:**
> "Por defecto, MoveHat incluye un contrato Counter de ejemplo. Vamos a reemplazarlo con un contrato más interesante de la documentación oficial de Movement."

### Paso 1: Abrir el proyecto
```bash
code .
```

### Paso 2: Reemplazar Counter.move

**[Navegar a `move/sources/Counter.move`]**

**NARRACIÓN:**
> "Vamos a crear un contrato llamado 'message' que nos permite guardar y actualizar mensajes en la blockchain."

**[Borrar todo el contenido de Counter.move]**

**[Copiar y pegar el siguiente código:]**

```move
module hello_blockchain::message {
    use std::error;
    use std::signer;
    use std::string::String;
    use aptos_framework::account;
    use aptos_framework::event;

    struct MessageHolder has key {
        message: String,
        message_change_events: event::EventHandle<MessageChangeEvent>,
    }

    struct MessageChangeEvent has drop, store {
        from_message: String,
        to_message: String,
    }

    const ENO_MESSAGE: u64 = 0;

    #[view]
    public fun signature(): address {
        @hello_blockchain
    }

    #[view]
    public fun get_message(addr: address): String acquires MessageHolder {
        assert!(exists<MessageHolder>(addr), error::not_found(ENO_MESSAGE));
        borrow_global<MessageHolder>(addr).message
    }

    public entry fun set_message(account: signer, message: String) acquires MessageHolder {
        let account_addr = signer::address_of(&account);
        if (!exists<MessageHolder>(account_addr)) {
            move_to(&account, MessageHolder {
                message,
                message_change_events: account::new_event_handle<MessageChangeEvent>(&account),
            });
        } else {
            let message_holder = borrow_global_mut<MessageHolder>(account_addr);
            let from_message = message_holder.message;
            event::emit_event(&mut message_holder.message_change_events, MessageChangeEvent {
                from_message,
                to_message: copy message,
            });
            message_holder.message = message;
        }
    }

    #[test(account = @0x1)]
    public entry fun sender_can_set_message(account: signer) acquires MessageHolder {
        let addr = signer::address_of(&account);
        aptos_framework::account::create_account_for_test(addr);
        set_message(account, std::string::utf8(b"Hello, Blockchain"));
        assert!(get_message(addr) == std::string::utf8(b"Hello, Blockchain"), ENO_MESSAGE);
    }

    #[test]
    public fun signature_okay() {
        assert!(signature() == @hello_blockchain, ENO_MESSAGE);
    }
}
```

**[Guardar el archivo]**

### Paso 3: Actualizar Move.toml

**[Navegar a `move/Move.toml`]**

**NARRACIÓN:**
> "Ahora necesitamos actualizar la configuración del módulo en Move.toml"

**[Cambiar la línea del nombre del módulo:]**

**ANTES:**
```toml
[addresses]
counter = "_"
```

**DESPUÉS:**
```toml
[addresses]
hello_blockchain = "_"
```

**[También actualizar en dev-addresses si existe]**

**ANTES:**
```toml
[dev-addresses]
counter = "0xcafe"
```

**DESPUÉS:**
```toml
[dev-addresses]
hello_blockchain = "0xcafe"
```

**[Guardar el archivo]**

---

## 🔨 Parte 4: Compilar el Contrato (30 segundos)

**[Volver al terminal]**

**NARRACIÓN:**
> "Ahora compilemos nuestro contrato usando MoveHat."

### Comando 6: Compilar
```bash
movehat compile
```

**[Mostrar output de compilación exitosa]**

**NARRACIÓN:**
> "¡Perfecto! El contrato se compiló sin errores ni warnings. MoveHat usó el Movement CLI por debajo para compilar nuestro código Move."

---

## 🧪 Parte 5: Tests en Move (1 minuto)

**NARRACIÓN:**
> "Uno de los superpoderes de MoveHat es que soporta tests tanto en Move como en TypeScript. Empecemos con los tests de Move que ya incluimos en el contrato."

### Comando 7: Ejecutar tests de Move
```bash
movehat test:move
```

**[Mostrar output de los tests pasando]**

**NARRACIÓN:**
> "Como puedes ver, los tests de Move se ejecutan en milisegundos. Son perfectos para probar la lógica interna de tu contrato de forma ultra-rápida."

---

## 🧪 Parte 6: Tests en TypeScript (3 minutos)

**[Volver al editor]**

**NARRACIÓN:**
> "Ahora vamos a crear tests de integración en TypeScript. Estos tests usan la API de Transaction Simulation de Movement, lo que significa que no necesitamos blockchain local ni gastar gas."

### Paso 1: Crear archivo de test

**[Navegar a `tests/Counter.test.ts`]**

**NARRACIÓN:**
> "Vamos a reemplazar el test de Counter con tests para nuestro contrato de mensajes."

**[Renombrar archivo:]**
- `tests/Counter.test.ts` → `tests/Message.test.ts`

**[Copiar y pegar el siguiente código:]**

```typescript
import { describe, it, before } from "mocha";
import { expect } from "chai";
import { getMovehat, type MovehatRuntime } from "movehat";

describe("Message Contract", () => {
  let mh: MovehatRuntime;
  let contractAddress: string;

  before(async function () {
    this.timeout(30000);

    // Initialize Movehat Runtime Environment
    mh = await getMovehat();
    contractAddress = mh.account.accountAddress.toString();

    console.log(`\nTesting on ${mh.network.name}`);
    console.log(`Account: ${contractAddress}\n`);
  });

  describe("Message functionality", () => {
    it("should set and retrieve a message using simulation", async function () {
      this.timeout(30000);

      const testMessage = "Hello from MoveHat!";

      // Build set_message transaction
      const transaction = await mh.aptos.transaction.build.simple({
        sender: mh.account.accountAddress,
        data: {
          function: `${contractAddress}::message::set_message`,
          functionArguments: [testMessage]
        }
      });

      // Simulate transaction (no gas cost, instant)
      const [simulation] = await mh.aptos.transaction.simulate.simple({
        signerPublicKey: mh.account.publicKey,
        transaction
      });

      // Verify simulation succeeded
      expect(simulation.success).to.be.true;
      console.log(`Message set successfully!`);
      console.log(`Gas used: ${simulation.gas_used}`);
      console.log(`Message: "${testMessage}"`);
    });

    it("should verify signature function", async function () {
      this.timeout(30000);

      // Call view function to get signature
      const signature = await mh.aptos.view({
        payload: {
          function: `${contractAddress}::message::signature`,
          functionArguments: []
        }
      });

      console.log(`Contract signature: ${signature[0]}`);
      expect(signature[0]).to.equal(contractAddress);
    });
  });
});
```

**[Guardar el archivo]**

### Paso 2: Ejecutar tests de TypeScript

**[Volver al terminal]**

**NARRACIÓN:**
> "Ahora ejecutemos los tests de TypeScript. Recuerda, estos usan Transaction Simulation, así que no necesitas configurar nada, ni siquiera una cuenta con fondos."

### Comando 8: Ejecutar tests de TypeScript
```bash
movehat test:ts
```

**[Mostrar output de los tests pasando con detalles]**

**NARRACIÓN:**
> "¡Excelente! Los tests pasaron. Como puedes ver, MoveHat automáticamente:
> - Se conectó a Movement testnet
> - Generó una cuenta de prueba
> - Simuló las transacciones sin costo
> - Y nos mostró el gas que se usaría en una transacción real"

---

## 🎯 Parte 7: Ejecutar Todos los Tests (30 segundos)

**NARRACIÓN:**
> "MoveHat también puede ejecutar ambos tipos de tests juntos. Primero ejecuta los tests de Move (súper rápidos) y luego los de TypeScript."

### Comando 9: Ejecutar todos los tests
```bash
npm test
```

**[Mostrar output mostrando ambos tipos de tests ejecutándose]**

**NARRACIÓN:**
> "Como puedes ver, primero corrieron los tests de Move en milisegundos, y luego los tests de TypeScript. Esta estrategia de 'fail-fast' te ayuda a detectar errores más rápido."

---

## 🌟 Parte 8: Funcionalidades Extras (1 minuto)

**NARRACIÓN:**
> "MoveHat incluye muchas otras funcionalidades útiles."

### Ver ayuda general
```bash
movehat --help
```

**[Mostrar lista de comandos]**

**NARRACIÓN:**
> "Como puedes ver, MoveHat incluye:
> - Sistema de forks para pruebas locales con estado real de la red
> - Scripts de deployment en TypeScript
> - Tracking automático de deployments por red
> - Y mucho más"

### Mostrar comandos de fork
```bash
movehat fork --help
```

**[Mostrar opciones de fork]**

**NARRACIÓN:**
> "Con el sistema de forks puedes crear una copia local del estado de Movement Network para hacer pruebas complejas sin gastar gas real."

---

## 🎬 Conclusión (30 segundos)

**[Terminal limpio o pantalla del proyecto]**

**NARRACIÓN:**
> "Y eso es todo! En menos de 10 minutos hemos:
> - Instalado MoveHat
> - Creado un proyecto desde cero
> - Escrito un smart contract en Move
> - Creado tests en Move y TypeScript
> - Y todo funcionó sin configuración complicada
>
> MoveHat hace que desarrollar en Movement Network sea tan fácil como desarrollar en Ethereum con Hardhat.
>
> Para más información, visita la documentación en GitHub. ¡Gracias por ver esta demo!"

---

## 📋 Checklist de Grabación

Antes de grabar, asegúrate de:

- [ ] Tener MoveHat instalado globalmente
- [ ] Tener Node.js v18+ instalado
- [ ] Tener Movement CLI instalado (`movement --version`)
- [ ] Terminal con buen contraste de colores
- [ ] Editor de código configurado (VS Code recomendado)
- [ ] Conexión a internet estable (para npm y testnet)
- [ ] Limpiar terminal antes de cada sección
- [ ] Tener el código del contrato y tests listos para copiar/pegar

## 🎥 Tips para Grabación

1. **Velocidad**: No apresures los comandos, deja que el viewer vea el output
2. **Pausas**: Haz pausas de 2-3 segundos después de cada comando importante
3. **Zoom**: Asegúrate que el texto sea legible (font size 14-16 mínimo)
4. **Errores**: Si algo falla, está bien! Muestra cómo debuggear
5. **Energía**: Mantén un tono entusiasta pero profesional

## ⏱️ Tiempo Total Estimado

- Introducción: 30s
- Instalación: 1min
- Crear Proyecto: 1min
- Preparar Contrato: 2min
- Compilar: 30s
- Tests Move: 1min
- Tests TypeScript: 3min
- Todos los Tests: 30s
- Extras: 1min
- Conclusión: 30s

**Total: ~10-11 minutos**

---

## 🔗 Links Útiles

- **Repositorio**: https://github.com/gilbertsahumada/movehat
- **Movement Docs**: https://docs.movementnetwork.xyz
- **Contrato Original**: https://docs.movementnetwork.xyz/devs/firstMoveContract

---

**¡Buena suerte con tu demo! 🚀**
