# Three-role model: admin, manager, employee

The charter fixed two task roles (managers assign, employees complete) and "deliberately
minimal" auth. During the ticket #5 grilling we needed someone to send user invites, which
puts user-provisioning inside the app, so we split authority into three roles instead of two:

- **Admin** — chain/HQ level, not location-scoped. Full user management everywhere: invite
  any user, set roles (including minting managers and other admins), set a user's location,
  deactivate users. Can do anything a manager can at any location.
- **Manager** — scoped to one location. Runs that location's task board (create, assign,
  edit, delete) and can invite employees to their own location. Cannot create managers or
  admins, and cannot act on other locations.
- **Employee** — scoped to one location. Views and completes only the tasks assigned to them.

We chose this because provisioning must exist (someone sends invites) but role-elevation must
stay controlled: managers onboard their own floor staff, while creating managers/admins is an
admin-only, HQ-level act. Admin is the franchise owner / operations lead; manager is the
location authority.

This supersedes the charter's two-role note. Consequence: user-provisioning (invite → accept →
role/location) enters scope — a small, deliberate expansion beyond the charter's "minimal auth."
