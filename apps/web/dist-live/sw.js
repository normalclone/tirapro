/**
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// If the loader is already loaded, just stop.
if (!self.define) {
  let registry = {};

  // Used for `eval` and `importScripts` where we can't get script URL by other means.
  // In both cases, it's safe to use a global var because those functions are synchronous.
  let nextDefineUri;

  const singleRequire = (uri, parentUri) => {
    uri = new URL(uri + ".js", parentUri).href;
    return registry[uri] || (
      
        new Promise(resolve => {
          if ("document" in self) {
            const script = document.createElement("script");
            script.src = uri;
            script.onload = resolve;
            document.head.appendChild(script);
          } else {
            nextDefineUri = uri;
            importScripts(uri);
            resolve();
          }
        })
      
      .then(() => {
        let promise = registry[uri];
        if (!promise) {
          throw new Error(`Module ${uri} didn’t register its module`);
        }
        return promise;
      })
    );
  };

  self.define = (depsNames, factory) => {
    const uri = nextDefineUri || ("document" in self ? document.currentScript.src : "") || location.href;
    if (registry[uri]) {
      // Module is already loading or loaded.
      return;
    }
    let exports = {};
    const require = depUri => singleRequire(depUri, uri);
    const specialDeps = {
      module: { uri },
      exports,
      require
    };
    registry[uri] = Promise.all(depsNames.map(
      depName => specialDeps[depName] || require(depName)
    )).then(deps => {
      factory(...deps);
      return exports;
    });
  };
}
define(['./workbox-7e5eb42b'], (function (workbox) { 'use strict';

  self.skipWaiting();
  workbox.clientsClaim();
  /**
   * The precacheAndRoute() method efficiently caches and responds to
   * requests for URLs in the manifest.
   * See https://goo.gl/S9QRab
   */
  workbox.precacheAndRoute([{
    "url": "registerSW.js",
    "revision": "1872c500de691dce40960bb85481de07"
  }, {
    "url": "index.html",
    "revision": "60fa44d5ea0b02fe68de5ccf636f6da5"
  }, {
    "url": "assets/_ui-D5m_wssq.js",
    "revision": null
  }, {
    "url": "assets/WorkflowSettingsPage-x0BpYucn.js",
    "revision": null
  }, {
    "url": "assets/WikiPage-Dwu7zitU.js",
    "revision": null
  }, {
    "url": "assets/vi-l5rj3ny4.js",
    "revision": null
  }, {
    "url": "assets/useAssigneeOptions-CuHtqb0Y.js",
    "revision": null
  }, {
    "url": "assets/upload-DCXOz3IH.js",
    "revision": null
  }, {
    "url": "assets/TriagePage-DV5TMCQU.js",
    "revision": null
  }, {
    "url": "assets/TreePage-CNroYXID.js",
    "revision": null
  }, {
    "url": "assets/trash-2-CxLdnf90.js",
    "revision": null
  }, {
    "url": "assets/target-1sAAA0RJ.js",
    "revision": null
  }, {
    "url": "assets/tag-DGoiTAoi.js",
    "revision": null
  }, {
    "url": "assets/style-Fd0xVSp_.css",
    "revision": null
  }, {
    "url": "assets/style-BKsxzuw3.js",
    "revision": null
  }, {
    "url": "assets/string-CvptbcKz.js",
    "revision": null
  }, {
    "url": "assets/statusColor-CHOzkM4u.js",
    "revision": null
  }, {
    "url": "assets/SlaPage-BbmVb-z9.js",
    "revision": null
  }, {
    "url": "assets/shield-DR-pExnh.js",
    "revision": null
  }, {
    "url": "assets/shield-alert-Ds3euUKF.js",
    "revision": null
  }, {
    "url": "assets/SettingsLayout-ClLBS4Sa.js",
    "revision": null
  }, {
    "url": "assets/RolesPage-tRyVvuXf.js",
    "revision": null
  }, {
    "url": "assets/RoleMultiSelect-CBoZl2hM.js",
    "revision": null
  }, {
    "url": "assets/RoleBadge-DEv8DZ_r.js",
    "revision": null
  }, {
    "url": "assets/ResourcesPage-D2vnvo8y.js",
    "revision": null
  }, {
    "url": "assets/ReportsPage-B9i_cTCP.js",
    "revision": null
  }, {
    "url": "assets/recentIssues-CMRrL-x4.js",
    "revision": null
  }, {
    "url": "assets/RaidPage-BcL7CPFc.js",
    "revision": null
  }, {
    "url": "assets/QueryError-DPblqRsL.js",
    "revision": null
  }, {
    "url": "assets/ProjectConfigPage-WVF4PMVS.js",
    "revision": null
  }, {
    "url": "assets/ProjectActivityPage-3ejhSI1w.js",
    "revision": null
  }, {
    "url": "assets/PortfolioPage-BlWl9EaF.js",
    "revision": null
  }, {
    "url": "assets/play-CZmRmjqI.js",
    "revision": null
  }, {
    "url": "assets/PieChart-C9P-fusb.js",
    "revision": null
  }, {
    "url": "assets/PeoplePicker-ueY9i7tQ.js",
    "revision": null
  }, {
    "url": "assets/pencil-DzKiXxnJ.js",
    "revision": null
  }, {
    "url": "assets/page-qKYyNfa7.js",
    "revision": null
  }, {
    "url": "assets/MembersPage-RFOGThTl.js",
    "revision": null
  }, {
    "url": "assets/ManageLayout-BestkPle.js",
    "revision": null
  }, {
    "url": "assets/mail-V9b3REi0.js",
    "revision": null
  }, {
    "url": "assets/link-2-CZRu9osK.js",
    "revision": null
  }, {
    "url": "assets/key-round-BBW-JcVE.js",
    "revision": null
  }, {
    "url": "assets/IssueTypeBadge-BMNBxuSV.js",
    "revision": null
  }, {
    "url": "assets/issueTree-CnU5Y2Bi.js",
    "revision": null
  }, {
    "url": "assets/IssueDetailPage-U9AckTC-.js",
    "revision": null
  }, {
    "url": "assets/IntegrationsPage-DHe2BJMG.js",
    "revision": null
  }, {
    "url": "assets/index-CNvRo8eW.js",
    "revision": null
  }, {
    "url": "assets/index-BTDEEic0.js",
    "revision": null
  }, {
    "url": "assets/index-Bl-biuJz.css",
    "revision": null
  }, {
    "url": "assets/image-Bne1rDA_.js",
    "revision": null
  }, {
    "url": "assets/history-B0bJE_dV.js",
    "revision": null
  }, {
    "url": "assets/hash-CM_XuA-D.js",
    "revision": null
  }, {
    "url": "assets/GoalsPage-CD69gwCv.js",
    "revision": null
  }, {
    "url": "assets/git-branch-CnMBJSdH.js",
    "revision": null
  }, {
    "url": "assets/GanttPage-oQSDHT29.js",
    "revision": null
  }, {
    "url": "assets/format-CxHL321T.js",
    "revision": null
  }, {
    "url": "assets/FiltersPage-oMzjYpkX.js",
    "revision": null
  }, {
    "url": "assets/EditRolesPopover-CeTqFnfp.js",
    "revision": null
  }, {
    "url": "assets/DueBadge-BdX2QZP3.js",
    "revision": null
  }, {
    "url": "assets/DocumentationPage-BQ9vahyS.js",
    "revision": null
  }, {
    "url": "assets/differenceInCalendarDays-XL9F7WYI.js",
    "revision": null
  }, {
    "url": "assets/DescriptionEditor-DY8_isfu.js",
    "revision": null
  }, {
    "url": "assets/DashboardPage-0x4Zq7XP.js",
    "revision": null
  }, {
    "url": "assets/CreateIssueModal-BEQFIwSA.js",
    "revision": null
  }, {
    "url": "assets/copy-DafBf_Py.js",
    "revision": null
  }, {
    "url": "assets/ConnectLayout-vbDySdxZ.js",
    "revision": null
  }, {
    "url": "assets/ConfirmDialog-CExu90at.js",
    "revision": null
  }, {
    "url": "assets/CommandPalette-C9EBqmT8.js",
    "revision": null
  }, {
    "url": "assets/ClientsPage-CeydrfZo.js",
    "revision": null
  }, {
    "url": "assets/circle-dot-CnKDCBFM.js",
    "revision": null
  }, {
    "url": "assets/circle-check-UxYGQrHk.js",
    "revision": null
  }, {
    "url": "assets/chevron-right-BdHQYWY6.js",
    "revision": null
  }, {
    "url": "assets/calendar-range-B5vwNunO.js",
    "revision": null
  }, {
    "url": "assets/calendar-clock-DeUE2vdV.js",
    "revision": null
  }, {
    "url": "assets/BoardPage-BZEF1N5E.js",
    "revision": null
  }, {
    "url": "assets/BacklogPage-CSwrMEKR.js",
    "revision": null
  }, {
    "url": "assets/AvatarUploader-B7I2zvjN.js",
    "revision": null
  }, {
    "url": "assets/AutomationPage-CFzLMvpX.js",
    "revision": null
  }, {
    "url": "assets/AssigneeFilter-7DTr0AcE.js",
    "revision": null
  }, {
    "url": "assets/arrow-right-Bo5AIBpJ.js",
    "revision": null
  }, {
    "url": "assets/ApiKeysPage-CSV7_Lf9.js",
    "revision": null
  }, {
    "url": "assets/api-YSoNtEUe.js",
    "revision": null
  }, {
    "url": "assets/api-lcGGsZi-.js",
    "revision": null
  }, {
    "url": "assets/api-DUzzR3oi.js",
    "revision": null
  }, {
    "url": "assets/api-DQ-9f2cv.js",
    "revision": null
  }, {
    "url": "assets/api-DnE5LFFQ.js",
    "revision": null
  }, {
    "url": "assets/api-CaF387s4.js",
    "revision": null
  }, {
    "url": "assets/api-BdP-5cC5.js",
    "revision": null
  }, {
    "url": "assets/alarm-clock-D2jz9ngq.js",
    "revision": null
  }, {
    "url": "assets/AdminWorkspacesPage-CVsLmHaU.js",
    "revision": null
  }, {
    "url": "assets/AdminUsersPage-BCzjOA88.js",
    "revision": null
  }, {
    "url": "assets/AdminSystemPage-B5WcmYHu.js",
    "revision": null
  }, {
    "url": "assets/AdminOverviewPage-94sV5iwF.js",
    "revision": null
  }, {
    "url": "assets/AdminLayout-B55IwkE6.js",
    "revision": null
  }, {
    "url": "assets/AdminConfigPage-2gVQkZAF.js",
    "revision": null
  }, {
    "url": "assets/AccountPage-BXZ95Bgw.js",
    "revision": null
  }, {
    "url": "manifest.webmanifest",
    "revision": "1fe0609311949f73b493c5ccb49ddc0f"
  }], {});
  workbox.cleanupOutdatedCaches();
  workbox.registerRoute(new workbox.NavigationRoute(workbox.createHandlerBoundToURL("index.html")));

}));
