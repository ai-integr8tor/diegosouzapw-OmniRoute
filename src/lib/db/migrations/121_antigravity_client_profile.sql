-- 121_antigravity_client_profile.sql
-- Convert persisted Antigravity legacy client profiles once, without retaining
-- harness/sdk as runtime aliases.

UPDATE provider_connections
SET provider_specific_data = json_set(provider_specific_data, '$.clientProfile', 'cli')
WHERE provider IN ('antigravity', 'agy')
  AND provider_specific_data IS NOT NULL
  AND CASE
    WHEN json_valid(provider_specific_data) THEN
      json_type(provider_specific_data, '$.clientProfile') = 'text'
      AND lower(trim(json_extract(provider_specific_data, '$.clientProfile'))) IN ('harness', 'sdk')
    ELSE 0
  END;
