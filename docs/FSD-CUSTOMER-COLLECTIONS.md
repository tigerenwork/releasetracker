# FSD — Customer Collections

## Overview

Customer Collections are named, reusable sets of customers. They capture stable
groupings (e.g. "the 10 customers running Service A", "all 20 customers running
Service B") so release activation becomes a two-click selection instead of
hand-picking customers every time.

## User Stories

- US-001: As a release manager, I can create a named collection of customers so
  that I can reuse the grouping across releases.
- US-002: As a release manager, I can edit a collection's name, description and
  membership at any time.
- US-003: As a release manager, I can delete a collection without affecting the
  customers themselves.
- US-004: As a release manager, when activating a draft release, I can click a
  collection chip to select exactly its members, then fine-tune individual
  customers before activating.
- US-005: As a release manager, when adding customers to an active release, I
  can use the same collection chips to pick among not-yet-enrolled customers.

## UX

### Management — `/customers` → "Collections" tab

- The Customers page has two tabs: **Customers** (existing) and **Collections**.
- Each collection card shows: name, description, member count, cluster spread
  ("8 in pingcap, 2 in eks"), and Edit / Delete actions. Delete asks for
  confirmation and is a soft delete.
- New Collection / Edit opens a dialog with name (required), description
  (optional), and the shared customer picker (search, cluster-grouped
  checkboxes with cluster-level toggles, Select All / Deselect All).

### Usage — Activate Release / Add Customer dialogs

- A row of collection chips (`name (count)`) appears above the search box.
- Clicking a chip **replaces** the current selection with exactly the
  collection's active members ("replace, then fine-tune"). The chip stays
  highlighted until any manual checkbox change.
- All other dialog behavior is unchanged (default all-selected on activate,
  search, cluster toggles, footer count).

## Behavior Rules

- Membership is stored as customer IDs. Customers created later are NOT
  auto-added to existing collections.
- Inactive/deleted customers are omitted from member counts and chip
  application; they remain as join rows until the collection is edited.
- Applying a collection in the Add Customer dialog only selects members that
  are not already enrolled in the release (already-enrolled customers are not
  shown there at all).
- Collections are purely a client-side selection aid: `activateRelease` /
  `addCustomersToRelease` still receive plain customer ID arrays.
