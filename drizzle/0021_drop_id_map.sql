-- 0020 kept _id_map (old integer id -> new UUID per table) so scripts/id-migration/verify.ts
-- could check the production run. Production checked out on 2026-11-26; it isn't needed any more.
DROP TABLE IF EXISTS `_id_map`;
