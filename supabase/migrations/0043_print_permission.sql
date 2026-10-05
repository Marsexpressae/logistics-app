-- "Print documents": receipts, return forms, parcel labels and statements. Granted to every role today, so nothing changes
-- until a super admin removes it from a role on the Roles page.
insert into permissions (key, group_name, label, description, sort) values
  ('documents.print', 'General', 'Print documents', 'Print receipts, return forms, parcel labels and statements', 95)
on conflict (key) do nothing;
insert into role_permissions (role, permission)
select r.key, 'documents.print' from roles r
on conflict do nothing;
