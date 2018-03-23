/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// this extension requires a 'control server' to be running on port 8000
// (see raptor prototype framework). It will provide the test options, as
// well as receive test results

// note: currently the prototype assumes the test page(s) are
// already available somewhere independently; so for now locally
// inside the 'talos-pagesets' dir or 'heroes' dir (tarek's github
// repo) or 'webkit/PerformanceTests' dir (for benchmarks) first run:
// 'python -m SimpleHTTPServer 8081'
// to serve out the pages that we want to prototype with. Also
// update the manifest content 'matches' accordingly


var settingsURL = null;
var testType;
var pageCycles = 0;
var pageCycle = 0;
var pageCycleDelay = 1000;
var testURL;
var testTabID = 0;
var results = {'page': '', 'measurements': {}};
var getHero = false;
var getFNBPaint = false;
var isHeroPending = false;
var pendingHeroes = [];
var settings = {};
var isFNBPaintPending = false;
var isBenchmarkPending = false;


function getTestSettings() {
  console.log("getting test settings from control server");
  return new Promise(resolve => {

    fetch(settingsURL).then(function(response) {
      response.text().then(function(text) {
        console.log(text);
        settings = JSON.parse(text)['raptor-options'];

        // parse the test settings
        testType = settings['type'];
        pageCycles = settings['page_cycles'];
        testURL = settings['test_url'];
        results['page'] = testURL;
        results['type'] = testType;

        if (testType == 'tp7') {
          getFNBPaint = settings['measure']['fnbpaint'];
          if (settings['measure']['hero'].length !== 0) {
            getHero = true;
          }
        }

        // write options to storage that our content script needs to know
        browser.storage.local.clear().then(function() {
          browser.storage.local.set({settings}).then(function() {
            console.log('wrote settings to ext local storage');
            resolve();
          });
        });
      });
    });
  });
}

function getBrowserInfo() {
  return new Promise(resolve => {
    var gettingInfo = browser.runtime.getBrowserInfo();
    gettingInfo.then(function(bi) {
      results['browser'] = bi.name + ' ' + bi.version + ' ' + bi.buildID;
      console.log('testing on ' + results['browser']);
      resolve();
    });
  });
}

function testTabCreated(tab){
  testTabID = tab.id;
  console.log("opened new empty tab " + testTabID);
  nextCycle();
}

async function testTabUpdated(tab) {
  console.log('tab ' + tab.id + ' reloaded');
  // wait for pageload test result from content
  await waitForResult();
  // move on to next cycle (or test complete)
  nextCycle();
}

function waitForResult() {
  console.log("awaiting results...");
  return new Promise(resolve => {
    function checkForResult() {
      if (testType == 'tp7') {
        if (!isHeroPending && !isFNBPaintPending) {
          resolve();
        } else {
          setTimeout(checkForResult, 5);
        }
      } else if (testType == 'benchmark') {
        if (!isBenchmarkPending) {
          resolve();
        } else {
          setTimeout(checkForResult, 5);
        }
      }
    }
    checkForResult();
  });
}

function nextCycle() {
  pageCycle++;
  if (pageCycle == 1) {
    var text = "running " + pageCycles + " pagecycles of " + testURL
    postToControlServer("status", text);
  }
  if (pageCycle <= pageCycles) {
    setTimeout(function(){
      var text = "begin pagecycle " + pageCycle;
      console.log("\n" + text);
      postToControlServer("status", text);
      if (testType == 'tp7') {
        if (getHero)
          isHeroPending = true;
          pendingHeroes = Array.from(settings['measure']['hero']);
        if (getFNBPaint)
          isFNBPaintPending = true;
      } else if (testType == 'benchmark') {
        isBenchmarkPending = true;
      }
      // reload the test page
      browser.tabs.update(testTabID, {url:testURL}, testTabUpdated);
    }, pageCycleDelay);
  } else {
    verifyResults();
  }
}

function resultListener(request, sender, sendResponse) {
  console.log("received message from " + sender.tab.url);
  if (request.type && request.value) {
    console.log("result: " + request.type + " " + request.value);
    sendResponse({text: "confirmed " + request.type});

    if (!(request.type in results['measurements']))
      results['measurements'][request.type] = [];

    if (testType == 'tp7') {
      // a single tp7 pageload measurement was received
      if (request.type.indexOf("hero") > -1) {
        results['measurements'][request.type].push(request.value);
        var _found = request.type.split('hero:')[1];
        var index = pendingHeroes.indexOf(_found);
        if (index > -1) {
          pendingHeroes.splice(index, 1);
          if (pendingHeroes.length == 0) {
            console.log("measured all expected hero elements");
            isHeroPending = false;
          }
        }
      } else if (request.type == 'fnbpaint') {
        results['measurements']['fnbpaint'].push(request.value);
        isFNBPaintPending = false;
      }
    } else if (testType == 'benchmark') {
      // benchmark results received (all results for that complete benchmark run)
      console.log('received results from benchmark');
      results['measurements'][request.type].push(request.value);
      isBenchmarkPending = false;
    }
  } else {
    console.log("unknown message received from content: " + request);
  }
}

function verifyResults() {
  console.log("\nVerifying results:");
  console.log(results);
  for (var x in results['measurements']) {
    count = results['measurements'][x].length;
    if (count == pageCycles) {
      console.log('have ' + count + ' results for ' + x + ', as expected');
    } else {
      console.log('ERROR: expected ' + pageCycles + ' results for '
                  + x + ' but only have ' + count);
    }
  }
  postToControlServer("results", results);
}

function postToControlServer(msgType, msgData) {
  // requires 'control server' running at port 8000 to receive results
  var url = "http://127.0.0.1:8000/";
  var client = new XMLHttpRequest();
  client.onreadystatechange = function() {
    if (client.readyState == XMLHttpRequest.DONE && client.status == 200) {
      console.log("post success");
    }
  }

  client.open("POST", url, true);

  client.setRequestHeader("Content-Type", "application/json");
  if (client.readyState == 1) {
    console.log("posting to control server");
    var data = { "type": "webext_" + msgType, "data": msgData}
    client.send(JSON.stringify(data));
  }
  if (msgType == "results") {
    // we're finished, move to cleanup
    cleanUp();
  }
}

function cleanUp() {
  // close tab
  browser.tabs.remove(testTabID);
  console.log("closed tab " + testTabID);
  if (testType == 'tp7') {
    // remove listeners
    browser.runtime.onMessage.removeListener(resultListener);
    browser.tabs.onCreated.removeListener(testTabCreated);
    console.log("pageloader test finished");
  } else if (testType == 'benchmark'){
    console.log('benchmark complete');
  }
  window.onload = null;
  // done, dump to console to tell framework to shutdown browser
  window.dump("\n__raptor_shutdownBrowser\n");
  return;
}

function runner() {
  settingsURL = getSettingsURL();
  getBrowserInfo().then(function() {
    getTestSettings().then(function() {
      if (testType == 'benchmark') {
        // webkit benchmark type of test
        console.log('benchmark test start');
      } else if (testType == 'tp7') {
        // standard 'tp7' pageload test
        console.log("pageloader test start");
      }
      // results listener
      browser.runtime.onMessage.addListener(resultListener);
      // tab creation listener
      browser.tabs.onCreated.addListener(testTabCreated);
      // create new empty tab, which starts the test
      browser.tabs.create({url:"about:blank"});
    });
  });
}

window.onload = runner();
