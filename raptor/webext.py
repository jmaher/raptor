# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
from __future__ import absolute_import

import os

from mozlog import get_proxy_logger

LOG = get_proxy_logger(component='webext')


def install_webext(browser, profile):
    addons = []
    here = os.path.abspath(os.getcwd())

    if browser == 'firefox':
        addons.append(os.path.join(here, 'webext', 'raptor-firefox'))
        LOG.info("Installing addons:")
        LOG.info(addons)
        profile.addon_manager.install_addons(addons=addons)
    elif browser == 'chrome':
        # not done here; for chrome just use the --load-extension cmd line opt
        pass
    else:
        LOG.critical('abort: unsupported browser')
