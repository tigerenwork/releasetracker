# TSD — Customer Collections

## Data Model

Two tables in `src/lib/db/schema.ts`, with duplicated DDL in
`CREATE_TABLES_SQL` (`src/lib/db/index.ts`) — runtime `CREATE TABLE IF NOT
EXISTS` is the primary migration mechanism, no backfill needed.

```
customer_collections
  id INTEGER PK AUTOINCREMENT
  name TEXT NOT NULL
  description TEXT
  is_active INTEGER DEFAULT 1        -- soft delete
  created_at / updated_at INTEGER

collection_customers                 -- join table, modeled on release_customers
  collection_id INTEGER NOT NULL FK -> customer_collections(id) ON DELETE CASCADE
  customer_id    INTEGER NOT NULL FK -> customers(id) ON DELETE CASCADE
  added_at INTEGER
  PRIMARY KEY (collection_id, customer_id)
```

## Server Actions — `src/lib/actions/customer-collections.ts`

- `listCollections()` — active collections with `members → customer → cluster`.
- `createCollection({ name, description?, customerIds })` — insert + join rows.
- `updateCollection(id, { name?, description?, customerIds? })` — when
  `customerIds` is provided, membership is replaced (delete + insert).
- `deleteCollection(id)` — sets `isActive = false`.

All call `revalidatePath('/customers')` after mutation.

## UI Components

- `src/components/customers/customer-multi-picker.tsx` — shared picker
  extracted from the old activate dialog. Props: `customers`, `selectedIds`
  (controlled `Set<number>`), `onChange`, optional `collections`. Renders the
  count row, Select All / Deselect All, collection chips (replace semantics;
  manual edits clear the chip highlight via internal `activeCollectionId`),
  search, and cluster-grouped checkboxes.
- Used by: `activate-release-dialog.tsx`, `add-customer-dialog.tsx`,
  `collection-form-dialog.tsx`.
- `src/components/collections/collection-list.tsx` — cards + edit/delete,
  calls the server actions then `router.refresh()`.
- `src/components/collections/collection-form-dialog.tsx` — name/description
  inputs + `CustomerMultiPicker`.

## Wiring

- `/customers` page (`src/app/customers/page.tsx`): shadcn `Tabs`; fetches
  `listCustomers()` + `listCollections()`, maps collections to
  `CollectionEntry` (active members only, cluster spread).
- Release detail page (`src/app/releases/[id]/page.tsx`): fetches
  `listCollections()`, maps to `CollectionOption { id, name, customerIds }`
  (active members only) and passes through `ReleaseActions` into both dialogs.
- The picker intersects collection member IDs with the customers actually
  available in the dialog before applying.

## Notes

- No changes to `activateRelease` / `addCustomersToRelease` — collections
  resolve to plain customer ID arrays on the client.
- Inactive customers keep their join rows but are filtered at read time.
