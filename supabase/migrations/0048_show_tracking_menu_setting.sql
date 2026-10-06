-- Settings switch: show or hide the Tracking link in the left menu (on = shown, as it is today).
insert into app_settings (key, value, label, description) values
  ('show_tracking_menu', 'true'::jsonb,
   'Show Tracking in the menu',
   'When off, the Tracking link is hidden from the left menu for everyone. The page itself still works if someone opens its address.')
on conflict (key) do nothing;
