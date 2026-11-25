DROP INDEX `conversations_direct_idx`;--> statement-breakpoint
DROP INDEX `conversations_family_email_idx`;--> statement-breakpoint
ALTER TABLE `conversations` ADD `staff_user_id` integer REFERENCES users(id);--> statement-breakpoint
-- Direct threads become one-to-one. Each existing one goes to the only staff
-- member who has written in it, or else to the team owner. Safe to re-run.
UPDATE `conversations` SET `staff_user_id` = coalesce(
  (SELECT CASE WHEN count(DISTINCT m.sender_id) = 1 THEN max(m.sender_id) END
     FROM `messages` m
    WHERE m.conversation_id = `conversations`.id
      AND m.sender_id IS NOT NULL
      AND m.sender_id IS NOT `conversations`.parent_user_id),
  (SELECT t.coach_id FROM `teams` t WHERE t.id = `conversations`.team_id)
) WHERE `kind` = 'direct' AND `staff_user_id` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `conversations_direct_staff_idx` ON `conversations` (`team_id`,`staff_user_id`,`parent_user_id`) WHERE kind = 'direct';--> statement-breakpoint
CREATE UNIQUE INDEX `conversations_family_email_staff_idx` ON `conversations` (`team_id`,`staff_user_id`,`family_email`) WHERE kind = 'direct' and family_email is not null;