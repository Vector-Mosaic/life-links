-- Account erasure retires owner identity without retaining private profile data.
CREATE TABLE deleted_account_ids (id text PRIMARY KEY, deleted_at timestamptz NOT NULL);
CREATE FUNCTION life_links_reject_retired_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM deleted_account_ids WHERE id=NEW.id) THEN
    RAISE EXCEPTION 'Retired account identity cannot be reused' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER users_retired_identity BEFORE INSERT OR UPDATE OF id ON users
FOR EACH ROW EXECUTE FUNCTION life_links_reject_retired_account();

-- Preserve spent invitation capacity and global content-ID non-reuse without
-- retaining either receipt's association to a deleted owner.
ALTER TABLE account_registrations ADD COLUMN receipt_id text;
UPDATE account_registrations SET receipt_id=user_id;
ALTER TABLE account_registrations ALTER COLUMN receipt_id SET NOT NULL;
ALTER TABLE account_registrations DROP CONSTRAINT account_registrations_pkey;
ALTER TABLE account_registrations DROP CONSTRAINT account_registrations_user_id_fkey;
ALTER TABLE account_registrations ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE account_registrations ADD PRIMARY KEY(receipt_id);
ALTER TABLE account_registrations ADD UNIQUE(user_id);
ALTER TABLE account_registrations ADD FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE used_content_ids DROP CONSTRAINT used_content_ids_owner_id_fkey;
ALTER TABLE used_content_ids ALTER COLUMN owner_id DROP NOT NULL;
ALTER TABLE used_content_ids ADD FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE member_invitations DROP CONSTRAINT member_invitations_owner_id_fkey;
ALTER TABLE member_invitations ADD FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE provider_sign_in_identities DROP CONSTRAINT provider_sign_in_identities_owner_id_fkey;
ALTER TABLE provider_sign_in_identities ADD FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE phone_sign_in_identities DROP CONSTRAINT phone_sign_in_identities_owner_id_fkey;
ALTER TABLE phone_sign_in_identities ADD FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE provider_sign_in_attempts ADD COLUMN owner_id text REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX idx_provider_sign_in_attempts_owner ON provider_sign_in_attempts(owner_id) WHERE owner_id IS NOT NULL;
ALTER TABLE contact_verification_attempts ADD COLUMN owner_id text REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX idx_contact_verification_attempts_owner ON contact_verification_attempts(owner_id) WHERE owner_id IS NOT NULL;
-- Older ciphertext has no owner metadata. Invalidate only transient challenges
-- on upgrade rather than retaining unattributable account-link payloads.
DELETE FROM provider_sign_in_attempts;
DELETE FROM contact_verification_attempts;

CREATE TABLE provider_sign_in_revocation_credentials (
  provider text NOT NULL, issuer text NOT NULL, client_id text NOT NULL, subject text NOT NULL,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  encrypted_payload text NOT NULL CHECK(length(encrypted_payload) BETWEEN 1 AND 65536),
  PRIMARY KEY(provider,issuer,client_id,subject),
  FOREIGN KEY(provider,issuer,client_id,subject) REFERENCES provider_sign_in_identities(provider,issuer,client_id,subject) ON DELETE CASCADE
);
CREATE INDEX provider_sign_in_revocation_owner ON provider_sign_in_revocation_credentials(owner_id);
-- Minimal outage recovery after local erasure: only exact identity binding and
-- protected revocation material, with no email, profile, phone or account content.
CREATE TABLE provider_sign_in_revocation_cleanup (
  id text PRIMARY KEY, provider text NOT NULL, issuer text NOT NULL, client_id text NOT NULL, subject text NOT NULL,
  encrypted_payload text NOT NULL CHECK(length(encrypted_payload) BETWEEN 1 AND 65536),
  created_at timestamptz NOT NULL
);
CREATE INDEX provider_sign_in_revocation_cleanup_identity ON provider_sign_in_revocation_cleanup(provider,issuer,client_id,subject);

-- Remove preexisting orphan private protocol artifacts, never shared clients.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM remote_agent_protocol_state WHERE kind='Client' AND owner_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Shared remote clients must be ownerless before account deletion migration';
  END IF;
END $$;
DELETE FROM remote_agent_protocol_state child WHERE child.kind <> 'Client' AND (
  (child.owner_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=child.owner_id)) OR
  child.grant_hash IN (SELECT id_hash FROM remote_agent_protocol_state WHERE kind='Grant'
    AND owner_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=owner_id))
);
ALTER TABLE remote_agent_protocol_state ADD FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE;
-- Grant-first admission prevents children from being added after owner erasure.
CREATE FUNCTION life_links_require_remote_grant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.grant_hash IS NOT NULL AND NOT (NEW.kind='Grant' AND NEW.id_hash=NEW.grant_hash) THEN
    PERFORM 1 FROM remote_agent_protocol_state WHERE kind='Grant' AND id_hash=NEW.grant_hash FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Remote grant is retired' USING ERRCODE='23503'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER remote_agent_live_grant BEFORE INSERT OR UPDATE OF grant_hash,owner_id ON remote_agent_protocol_state
FOR EACH ROW EXECUTE FUNCTION life_links_require_remote_grant();
