/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// content script for use with pageload tests
var perfData = window.performance;
var gRetryCounter = 0;

// measure hero element; must exist inside test page;
// default only; this is set via control server settings json
var getHero = false;
var heroesToCapture = [];

// measure google's first-contentful-paint
// default only; this is set via control server settings json
var getFCP = false;

// performance.timing measurement used as 'starttime'
var startMeasure = "fetchStart";

function contentHandler() {
  // retrieve test settings from local ext storage
  chrome.storage.local.get("settings", function(item) {
    var settings = item['settings'];
    getFCP = settings['measure']['fcp'];
    if (settings['measure']['hero'].length !== 0) {
      getHero = true;
      heroesToCapture = settings['measure']['hero'];
    }
    if (getHero) {
      console.log('hero elements to measure: ' + heroesToCapture);
      measureHero();
    }
    if (getFCP) {
      console.log('will be measuring first-contentful-paint');
      measureFirstContentfulPaint();
    }
  });
}

function measureHero() {
  var obs = null;

  var heroElementsFound = window.document.querySelectorAll("[elementtiming]");
  console.log("found " + heroElementsFound.length + " hero elements in the page");

  if (heroElementsFound) {
    function callbackHero(entries, observer) {
      entries.forEach(entry => {
        heroFound = entry.target.getAttribute('elementtiming');
        // mark the time now as when hero element received
        perfData.mark(heroFound);
        console.log("found hero:" + heroFound);
        // calculcate result: time we got hero element - performance.timing.fetchStart
        perfData.measure(name=resultType,
                         startMark=startMeasure,
                         endMark=heroFound);
        perfResult = perfData.getEntriesByName(resultType);
        var _result = perfResult[0].duration;
        var resultType = "hero:" + heroFound;
        sendResult(resultType, _result);
        perfData.clearMarks();
        perfData.clearMeasures();
        obs.disconnect();
      });
    }
    // we want the element 100% visible on the viewport
    var options = {root: null, rootMargin: "0px", threshold: [1]};
    try {
      obs = new window.IntersectionObserver(callbackHero, options);
      heroElementsFound.forEach(function(el) {
        // if hero element is one we want to measure, add it to the observer
        if (heroesToCapture.indexOf(el.getAttribute('elementtiming')) > -1)
          obs.observe(el);
      });
    } catch (err) {
      console.log(err);
    }
  } else {
      console.log("couldn't find hero element");
  }
  return;
}

function measureFirstContentfulPaint() {
  // see https://developer.mozilla.org/en-US/docs/Web/API/PerformancePaintTiming
  var resultType = 'fcp';
  var result = 0;

  let performanceEntries = perfData.getEntriesByType('paint');

  if (performanceEntries.length >= 2) {
    if (performanceEntries[1].startTime != undefined)
      result = performanceEntries[1].startTime;
  }

  if (result > 0) {
    console.log("got time to first-contentful-paint");
    sendResult(resultType, result);
    perfData.clearMarks();
    perfData.clearMeasures();
  } else {
    gRetryCounter += 1;
    if (gRetryCounter <= 10) {
      console.log("\ntime to first-contentful-paint is not yet available (0), retry number " + gRetryCounter + "...\n");
      window.setTimeout(measureFirstContentfulPaint, 100);
    } else {
      console.log("\nunable to get a value for time-to-fcp after " + gRetryCounter + " retries\n");
    }
  }
}

function sendResult(_type, _value) {
  // send result back to background runner script
  console.log("sending result back to runner: " + _type + " " + _value);
  chrome.runtime.sendMessage({"type": _type, "value": _value}, function(response) {
    console.log(response.text);
  });
}

window.onload = contentHandler();
