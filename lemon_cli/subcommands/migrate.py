"""``lemon migrate`` subcommand parser."""

from __future__ import annotations


def build_migrate_parser(subparsers) -> None:
    """Attach the ``migrate`` subcommand to ``subparsers``."""
    from lemon_cli.migrate import cmd_migrate, cmd_migrate_identity, cmd_migrate_xai

    migrate_parser = subparsers.add_parser(
        "migrate", help="Migrate configuration for retired models or deprecated settings",
        description="Diagnose and (optionally) rewrite the active config.yaml to "
            "replace references to retired models or deprecated settings.")
    migrate_subparsers = migrate_parser.add_subparsers(dest="migrate_type")

    migrate_identity = migrate_subparsers.add_parser(
        "identity",
        help="Migrate legacy Lemon AI state into the Lemon AI home, or roll it back",
        description="Atomically rename the legacy default home to the Lemon AI default home. "
        "Refuses to merge when both locations contain data.",
    )
    identity_action = migrate_identity.add_mutually_exclusive_group()
    identity_action.add_argument(
        "--rollback", action="store_true", help="Move a marker-proven migrated home back to its legacy path"
    )
    identity_action.add_argument(
        "--force", action="store_true", help="Re-enable migration after an explicit rollback"
    )
    migrate_identity.set_defaults(func=cmd_migrate_identity)

    migrate_xai = migrate_subparsers.add_parser(
        "xai", help="Migrate xAI models scheduled for retirement on May 15, 2026",
        description="Scan config.yaml for references to xAI models retiring on "
            "May 15, 2026 and, with --apply, rewrite them in-place to the "
            "official replacements per the xAI migration guide. The original "
            "config.yaml is backed up before any rewrite.")
    migrate_xai.add_argument(
        "--apply", action="store_true",
        help="Rewrite config.yaml in-place (default: dry-run, no writes)")
    migrate_xai.add_argument(
        "--no-backup", action="store_true",
        help="Skip the timestamped backup of config.yaml when applying")
    migrate_xai.set_defaults(func=cmd_migrate_xai)
    migrate_parser.set_defaults(func=cmd_migrate)
