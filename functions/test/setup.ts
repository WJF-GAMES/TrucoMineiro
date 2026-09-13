/**
 * Ambiente dos testes das Functions. Roda antes de qualquer import de `src/`, que é quando
 * `lib/admin.ts` e `contacts.ts` leem as variáveis de ambiente.
 */
process.env.FUNCTIONS_EMULATOR = 'true';
process.env.CONTACTS_PEPPER = 'test-pepper';
