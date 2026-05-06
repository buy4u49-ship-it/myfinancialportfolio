create unique index if not exists app_user_records_profile_email_unique
  on public.app_user_records (lower(record->'profile'->>'email'))
  where coalesce(record->'profile'->>'email', '') <> '';
