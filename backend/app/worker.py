from __future__ import annotations

import time

from app.core.container import build_container


def main() -> None:
    container = build_container()
    while True:
        with container.session_factory() as db:
            processed = container.projection_service.process_pending(db)
            if processed:
                db.commit()
            else:
                db.rollback()
        time.sleep(2)


if __name__ == "__main__":
    main()
