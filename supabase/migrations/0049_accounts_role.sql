-- A role for the accounts team: they see invoices and customers and record payments, and nothing else.
-- It starts small on purpose. The owner can add or remove anything on Settings > Roles & Permissions.
insert into roles (key, label, description, sort)
values ('accounts', 'Accounts', 'Sees invoices and customers and records payments. Cannot change bookings, pickups, the warehouse or containers.', 6)
on conflict (key) do nothing;

insert into role_permissions (role, permission) values
  ('accounts', 'dashboard.view'),
  ('accounts', 'notifications.view'),
  ('accounts', 'documents.print'),
  ('accounts', 'bookings.view'),
  ('accounts', 'customers.view'),
  ('accounts', 'accounts.view'),
  ('accounts', 'payments.manage')
on conflict do nothing;
