# Fork Testing Reference

Comandos de prueba para verificar que el fork local de Movement L1 funciona correctamente.

## Pre-requisitos

1. Proxy corriendo: `node proxy.js`
2. Config de Aptos apuntando al proxy o usando `rest_url` correcto

## Inicializar Fork

```bash
# Opción 1: Usando el rest_url del config (RECOMENDADO)
aptos move sim init --path .movehat/sim

# Opción 2: Con --network (NO FUNCIONA para URLs custom por bug del CLI)
# aptos move sim init --path .movehat/sim --network https://testnet.movementnetwork.xyz/v1
```

**Resultado esperado:**
- Directorio `.movehat/sim/` creado
- `config.json` con base "Remote" y network_version
- `delta.json` vacío inicialmente (fork lazy)

## Verificar Chain ID

```bash
aptos move sim view-resource \
  --session .movehat/sim \
  --account 0x1 \
  --resource 0x1::chain_id::ChainId
```

**Resultado esperado:**
```json
{
  "Result": {
    "id": 250
  }
}
```

## Verificar Estado de Cuenta

```bash
aptos move sim view-resource \
  --session .movehat/sim \
  --account 0x662a2aa90fdf2b8e400640a49fc922b713fe4baaec8c37b088ecef315561e4d9 \
  --resource 0x1::account::Account
```

**Resultado esperado:**
- `sequence_number`: número de transacciones ejecutadas
- `guid_creation_num`: recursos creados

## Ver Balance de APT

```bash
aptos move sim view-resource \
  --session .movehat/sim \
  --account 0x662a2aa90fdf2b8e400640a49fc922b713fe4baaec8c37b088ecef315561e4d9 \
  --resource '0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>'
```

**Resultado esperado:**
```json
{
  "Result": {
    "coin": {
      "value": "99225700"
    },
    ...
  }
}
```

## Fondear Cuenta (Modificar Estado Local)

```bash
aptos move sim fund \
  --session .movehat/sim \
  --account 0x662a2aa90fdf2b8e400640a49fc922b713fe4baaec8c37b088ecef315561e4d9 \
  --amount 500000000
```

**Resultado esperado:**
- Carpeta `[N] fund (fungible)` creada
- `summary.json` con before/after amounts

## Ver Recurso de Contrato Custom

```bash
aptos move sim view-resource \
  --session .movehat/sim \
  --account 0x662a2aa90fdf2b8e400640a49fc922b713fe4baaec8c37b088ecef315561e4d9 \
  --resource 0x662a2aa90fdf2b8e400640a49fc922b713fe4baaec8c37b088ecef315561e4d9::message::MessageHolder
```

**Resultado esperado:**
```json
{
  "Result": {
    "message": "Updated Message",
    "message_change_events": {
      "counter": "5"
    }
  }
}
```

## Llamar Función View (Contra Red Real)

```bash
aptos move view \
  --function-id 0x662a2aa90fdf2b8e400640a49fc922b713fe4baaec8c37b088ecef315561e4d9::message::get_message \
  --args address:0x662a2aa90fdf2b8e400640a49fc922b713fe4baaec8c37b088ecef315561e4d9
```

**Nota:** Este comando NO usa `sim`, va contra la red real configurada en `rest_url`.

## Verificar Estructura del Fork

```bash
# Ver archivos creados
ls -la .movehat/sim/

# Ver config del fork
cat .movehat/sim/config.json | jq .

# Contar módulos descargados (si delta.json tiene datos)
jq 'keys | length' .movehat/sim/delta.json
```

## Limpiar Fork

```bash
rm -rf .movehat/sim
```

---

## Limitaciones Conocidas (CLI en BETA)

1. **No hay `aptos move sim publish`** - No se pueden publicar módulos nuevos al fork
2. **No hay `aptos move sim run`** - No se pueden ejecutar funciones entry
3. **Fork lazy** - Solo trae estado cuando lo consultas (eficiente pero puede confundir)
4. **`--network` con URLs custom no funciona** - Usar `rest_url` en config en su lugar
5. **`fund` no afecta views posteriores** - Posible bug en la versión BETA

## Workarounds

- Para publicar: Publicar primero en Movement testnet, luego forkear
- Para ejecutar transacciones: Usar el SDK de Aptos/Movement en TypeScript
- Para tests: Crear un bridge TypeScript que use el SDK contra el fork
