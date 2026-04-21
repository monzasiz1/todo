-- Dashboard performance indexes
-- Run in Supabase SQL Editor

CREATE INDEX IF NOT EXISTS idx_tasks_user_completed_sort_created
  ON tasks(user_id, completed, sort_order, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_user_date
  ON tasks(user_id, date);

CREATE INDEX IF NOT EXISTS idx_tasks_visibility_user
  ON tasks(visibility, user_id)
  WHERE visibility <> 'private';

CREATE INDEX IF NOT EXISTS idx_tasks_user_priority_completed
  ON tasks(user_id, priority, completed);

CREATE INDEX IF NOT EXISTS idx_task_permissions_user_view_task
  ON task_permissions(user_id, can_view, task_id);

CREATE INDEX IF NOT EXISTS idx_task_permissions_task_user
  ON task_permissions(task_id, user_id);

CREATE INDEX IF NOT EXISTS idx_group_tasks_task_group
  ON group_tasks(task_id, group_id);

CREATE INDEX IF NOT EXISTS idx_group_members_user_group
  ON group_members(user_id, group_id);

CREATE INDEX IF NOT EXISTS idx_friends_user_status_friend
  ON friends(user_id, status, friend_id);

CREATE INDEX IF NOT EXISTS idx_friends_friend_status_user
  ON friends(friend_id, status, user_id);
