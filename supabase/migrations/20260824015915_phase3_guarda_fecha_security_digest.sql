grant divat_audit_owner, divat_auditor to postgres;

do $$
declare
  digest_present boolean := to_regprocedure('public.divat_security_digest()') is not null
                          or to_regprocedure('audit.divat_security_digest()') is not null;
begin
  if digest_present then
    if to_regprocedure('public.divat_security_digest()') is not null then
      alter function public.divat_security_digest() set schema audit;
    end if;

    alter function audit.divat_security_digest() security definer;
    alter function audit.divat_security_digest() owner to divat_audit_owner;

    revoke all on function audit.divat_security_digest() from public, anon, authenticated, service_role;
    grant execute on function audit.divat_security_digest() to divat_auditor;

    if has_function_privilege('anon', 'audit.divat_security_digest()', 'execute')
       or has_function_privilege('authenticated', 'audit.divat_security_digest()', 'execute')
       or not has_function_privilege('divat_auditor', 'audit.divat_security_digest()', 'execute') then
      raise exception 'Fechamento de audit.divat_security_digest() falhou';
    end if;
  end if;
end $$;

revoke divat_audit_owner, divat_auditor from postgres;
