
'use strict';
const shim = require('fabric-shim');
const util = require('util');

/************************************************************************************************
 * 
 * GENERAL FUNCTIONS 
 * 
 ************************************************************************************************/

/**
 * Executes a query using a specific key
 * 
 * @param {*} key - the key to use in the query
 */
async function queryByKey(stub, key) {
  console.log('============= START : queryByKey ===========');
  console.log('##### queryByKey key: ' + key);

  let resultAsBytes = await stub.getState(key); 
  if (!resultAsBytes || resultAsBytes.toString().length <= 0) {
    throw new Error('##### queryByKey key: ' + key + ' does not exist');
  }
  console.log('##### queryByKey response: ' + resultAsBytes);
  console.log('============= END : queryByKey ===========');
  return resultAsBytes;
}

/**
 * Executes a query based on a provided queryString
 * 
 * I originally wrote this function to handle rich queries via CouchDB, but subsequently needed
 * to support LevelDB range queries where CouchDB was not available.
 * 
 * @param {*} queryString - the query string to execute
 */
async function queryByString(stub, queryString) {
  console.log('============= START : queryByString ===========');
  console.log("##### queryByString queryString: " + queryString);

  // CouchDB Query
  // let iterator = await stub.getQueryResult(queryString);

  // Equivalent LevelDB Query. We need to parse queryString to determine what is being queried
  // In this chaincode, all queries will either query ALL records for a specific docType, or
  // they will filter ALL the records looking for a specific NGO, Donor, Donation, etc. So far, 
  // in this chaincode there is a maximum of one filter parameter in addition to the docType.
  let docType = "";
  let startKey = "";
  let endKey = "";
  let jsonQueryString = JSON.parse(queryString);
  if (jsonQueryString['selector'] && jsonQueryString['selector']['docType']) {
    docType = jsonQueryString['selector']['docType'];
    startKey = docType + "0";
    endKey = docType + "z";
  }
  else {
    throw new Error('##### queryByString - Cannot call queryByString without a docType element: ' + queryString);   
  }

  let iterator = await stub.getStateByRange(startKey, endKey);

  // Iterator handling is identical for both CouchDB and LevelDB result sets, with the 
  // exception of the filter handling in the commented section below
  let allResults = [];
  while (true) {
    let res = await iterator.next();

    if (res.value && res.value.value.toString()) {
      let jsonRes = {};
      console.log('##### queryByString iterator: ' + res.value.value.toString('utf8'));

      jsonRes.Key = res.value.key;
      try {
        jsonRes.Record = JSON.parse(res.value.value.toString('utf8'));
      } 
      catch (err) {
        console.log('##### queryByString error: ' + err);
        jsonRes.Record = res.value.value.toString('utf8');
      }
      // ******************* LevelDB filter handling ******************************************
      // LevelDB: additional code required to filter out records we don't need
      // Check that each filter condition in jsonQueryString can be found in the iterator json
      // If we are using CouchDB, this isn't required as rich query supports selectors
      let jsonRecord = jsonQueryString['selector'];
      // If there is only a docType, no need to filter, just return all
      console.log('##### queryByString jsonRecord - number of JSON keys: ' + Object.keys(jsonRecord).length);
      if (Object.keys(jsonRecord).length == 1) {
        allResults.push(jsonRes);
        continue;
      }
      for (var key in jsonRecord) {
        if (jsonRecord.hasOwnProperty(key)) {
          console.log('##### queryByString jsonRecord key: ' + key + " value: " + jsonRecord[key]);
          if (key == "docType") {
            continue;
          }
          console.log('##### queryByString json iterator has key: ' + jsonRes.Record[key]);
          if (!(jsonRes.Record[key] && jsonRes.Record[key] == jsonRecord[key])) {
            // we do not want this record as it does not match the filter criteria
            continue;
          }
          allResults.push(jsonRes);
        }
      }
      // ******************* End LevelDB filter handling ******************************************
      // For CouchDB, push all results
      // allResults.push(jsonRes);
    }
    if (res.done) {
      await iterator.close();
      console.log('##### queryByString all results: ' + JSON.stringify(allResults));
      console.log('============= END : queryByString ===========');
      return Buffer.from(JSON.stringify(allResults));
    }
  }
}

/**
 * Record spend made by an NGO
 * 
 * This functions allocates the spend amongst the donors, so each donor can see how their 
 * donations are spent. The logic works as follows:
 * 
 *    - Get the donations made to this NGO
 *    - Get the spend per donation, to calculate how much of the donation amount is still available for spending
 *    - Calculate the total amount spent by this NGO
 *    - If there are sufficient donations available, create a SPEND record
 *    - Allocate the spend between all the donations and create SPENDALLOCATION records
 * 
 * @param {*} spend - the spend amount to be recorded. This will be JSON, as follows:
 * {
 *   "docType": "spend",
 *   "spendId": "1234",
 *   "spendAmount": 100,
 *   "spendDate": "2018-09-20T12:41:59.582Z",
 *   "spendDescription": "Delias Dainty Delights",
 *   "ngoRegistrationNumber": "1234"
 * }
 */
async function allocateSpend(stub, spend) {
  console.log('============= START : allocateSpend ===========');
  console.log('##### allocateSpend - Spend received: ' + JSON.stringify(spend));

  // validate we have a valid SPEND object and a valid amount
  if (!(spend && spend['spendAmount'] && typeof spend['spendAmount'] === 'number' && isFinite(spend['spendAmount']))) {
    throw new Error('##### allocateSpend - Spend Amount is not a valid number: ' + spend['spendAmount']);   
  }
  // validate we have a valid SPEND object and a valid SPEND ID
  if (!(spend && spend['spendId'])) {
    throw new Error('##### allocateSpend - Spend Id is required but does not exist in the spend message');   
  }

  // validate that we have a valid NGO
  let ngo = spend['ngoRegistrationNumber'];
  let ngoKey = 'ngo' + ngo;
  let ngoQuery = await queryByKey(stub, ngoKey);
  if (!ngoQuery.toString()) {
    throw new Error('##### allocateSpend - Cannot create spend allocation record as the NGO does not exist: ' + json['ngoRegistrationNumber']);
  }

  // first, get the total amount of donations donated to this NGO
  let totalDonations = 0;
  const donationMap = new Map();
  let queryString = '{"selector": {"docType": "donation", "ngoRegistrationNumber": "' + ngo + '"}}';
  let donationsForNGO = await queryByString(stub, queryString);
  console.log('##### allocateSpend - allocateSpend - getDonationsForNGO: ' + donationsForNGO);
  donationsForNGO = JSON.parse(donationsForNGO.toString());
  console.log('##### allocateSpend - getDonationsForNGO as JSON: ' + donationsForNGO);

  // store all donations for the NGO in a map. Each entry in the map will look as follows:
  //
  // {"Key":"donation2211","Record":{"docType":"donation","donationAmount":100,"donationDate":"2018-09-20T12:41:59.582Z","donationId":"2211","donorUserName":"edge","ngoRegistrationNumber":"6322"}}
  for (let n = 0; n < donationsForNGO.length; n++) {
    let donation = donationsForNGO[n];
    console.log('##### allocateSpend - getDonationsForNGO Donation: ' + JSON.stringify(donation));
    totalDonations += donation['Record']['donationAmount'];
    // store the donations made
    donationMap.set(donation['Record']['donationId'], donation);
    console.log('##### allocateSpend - donationMap - adding new donation entry for donor: ' + donation['Record']['donationId'] + ', values: ' + JSON.stringify(donation));
  }
  console.log('##### allocateSpend - Total donations for this ngo are: ' + totalDonations);
  for (let donation of donationMap) {
    console.log('##### allocateSpend - Total donation for this donation ID: ' + donation[0] + ', amount: ' + donation[1]['Record']['donationAmount'] + ', entry: ' + JSON.stringify(donation[1]));
  }

  // next, get the spend by Donation, i.e. the amount of each Donation that has already been spent
  let totalSpend = 0;
  const donationSpendMap = new Map();
  queryString = '{"selector": {"docType": "spendAllocation", "ngoRegistrationNumber": "' + ngo + '"}}';
  let spendAllocations = await queryByString(stub, queryString);
  spendAllocations = JSON.parse(spendAllocations.toString());
  for (let n = 0; n < spendAllocations.length; n++) {
    let spendAllocation = spendAllocations[n]['Record'];
    totalSpend += spendAllocation['spendAllocationAmount'];
    // store the spend made per Donation
    if (donationSpendMap.has(spendAllocation['donationId'])) {
      let spendAmt = donationSpendMap.get(spendAllocation['donationId']);
      spendAmt += spendAllocation['spendAllocationAmount'];
      donationSpendMap.set(spendAllocation['donationId'], spendAmt);
      console.log('##### allocateSpend - donationSpendMap - updating donation entry for donation ID: ' + spendAllocation['donationId'] + ' amount: ' + spendAllocation['spendAllocationAmount'] + ' total amt: ' + spendAmt);
    }
    else {
      donationSpendMap.set(spendAllocation['donationId'], spendAllocation['spendAllocationAmount']);
      console.log('##### allocateSpend - donationSpendMap - adding new donation entry for donation ID: ' + spendAllocation['donationId'] + ' amount: ' + spendAllocation['spendAllocationAmount']);
    }
  }
  console.log('##### allocateSpend - Total spend for this ngo is: ' + totalSpend);
  for (let donation of donationSpendMap) {
    console.log('##### allocateSpend - Total spend against this donation ID: ' + donation[0] + ', spend amount: ' + donation[1] + ', entry: ' + donation);  
    if (donationMap.has(donation[0])) {
      console.log('##### allocateSpend - The matching donation for this donation ID: ' + donation[0] + ', donation amount: ' + donationMap.get(donation[0]));  
    }
    else {
      console.log('##### allocateSpend - ERROR - cannot find the matching donation for this spend record for donation ID: ' + donation[0]);  
    }
  }

  // at this point we have the total amount of donations made by donors to each NGO. We also have the total spend
  // spent by an NGO with a breakdown per donation. 

  // confirm whether the NGO has sufficient available funds to cover the new spend
  let totalAvailable = totalDonations - totalSpend;
  if (spend['spendAmount'] > totalAvailable) {
    // Execution stops at this point; the transaction fails and rolls back.
    // Any updates made by the transaction processor function are discarded.
    // Transaction processor functions are atomic; all changes are committed,
    // or no changes are committed.
    console.log('##### allocateSpend - NGO ' + ngo + ' does not have sufficient funds available to cover this spend. Spend amount is: ' + spend['spendAmount'] + '. Available funds are currently: ' + totalAvailable + '. Total donations are: ' + totalDonations + ', total spend is: ' + totalSpend);
    throw new Error('NGO ' + ngo + ' does not have sufficient funds available to cover this spend. Spend amount is: ' + spend['spendAmount'] + '. Available funds are currently: ' + totalAvailable);
  }

  // since the NGO has sufficient funds available, add the new spend record
  spend['docType'] = 'spend';
  let key = 'spend' + spend['spendId'];
  console.log('##### allocateSpend - Adding the spend record to NGOSpend. Spend record is: ' + JSON.stringify(spend) + ' key is: ' + key);
  await stub.putState(key, Buffer.from(JSON.stringify(spend)));

  // allocate the spend as equally as possible to all the donations
  console.log('##### allocateSpend - Allocating the spend amount amongst the donations from donors who donated funds to this NGO');
  let spendAmount = spend.spendAmount;
  let numberOfDonations = 0;
  let spendAmountForDonor = 0;
  let recordCounter = 0;

  while (true) {
    // spendAmount will be reduced as the spend is allocated to NGOSpendDonationAllocation records. 
    // Once it reaches 0 we stop allocating. This caters for cases where the full allocation cannot
    // be allocated to a donation record. In this case, only the remaining domation amount is allocated 
    // (see variable amountAllocatedToDonation below).
    // The remaining amount must be allocated to donation records with sufficient available funds.
    if (spendAmount <= 0) {
      break;
    }
    // calculate the number of donations still available, i.e. donations which still have funds available for spending. 
    // as the spending reduces the donations there may be fewer and fewer donations available to split the spending between
    // 
    // all donations for the NGO are in donationMap. Each entry in the map will look as follows:
    //
    // {"Key":"donation2211","Record":{"docType":"donation","donationAmount":100,"donationDate":"2018-09-20T12:41:59.582Z","donationId":"2211","donorUserName":"edge","ngoRegistrationNumber":"6322"}}
    numberOfDonations = 0;
    for (let donation of donationMap) {
      console.log('##### allocateSpend - Donation record, key is: ' +  donation[0] + ' value is: ' + JSON.stringify(donation[1]));
      if (donationSpendMap.has(donation[0])) {
        spendAmountForDonor = donationSpendMap.get(donation[0]);
      }
      else {
        spendAmountForDonor = 0;
      }
      let availableAmountForDonor = donation[1]['Record']['donationAmount'] - spendAmountForDonor;
      console.log('##### allocateSpend - Checking number of donations available for allocation. Donation ID: ' +  donation[0] + ' has spent: ' + spendAmountForDonor + ' and has the following amount available for spending: ' + availableAmountForDonor);
      if (availableAmountForDonor > 0) {
        numberOfDonations++;
      }
    }
    //Validate that we have a valid spendAmount, numberOfDonations and spendAmountForDonor
    //Invalid values could be caused by a bug in this function, or invalid values passed to this function
    //that were not caught by the validation process earlier.
    if (!(spendAmount && typeof spendAmount === 'number' && isFinite(spendAmount))) {
      throw new Error('##### allocateSpend - spendAmount is not a valid number: ' + spendAmount);   
    }
    if (!(numberOfDonations && typeof numberOfDonations === 'number' && numberOfDonations > 0)) {
      throw new Error('##### allocateSpend - numberOfDonations is not a valid number or is < 1: ' + numberOfDonations);   
    }
    //calculate how much spend to allocate to each donation
    let spendPerDonation = spendAmount / numberOfDonations;
    console.log('##### allocateSpend - Allocating the total spend amount of: ' + spendAmount + ', to ' + numberOfDonations + ' donations, resulting in ' + spendPerDonation + ' per donation');

    if (!(spendPerDonation && typeof spendPerDonation === 'number' && isFinite(spendPerDonation))) {
      throw new Error('##### allocateSpend - spendPerDonation is not a valid number: ' + spendPerDonation);   
    }

    // create the SPENDALLOCATION records. Each record looks as follows:
    //
    // {
    //   "docType":"spendAllocation",
    //   "spendAllocationId":"c5b39e938a29a80c225d10e8327caaf817f76aecd381c868263c4f59a45daf62-1",
    //   "spendAllocationAmount":38.5,
    //   "spendAllocationDate":"2018-09-20T12:41:59.582Z",
    //   "spendAllocationDescription":"Peter Pipers Poulty Portions for Pets",
    //   "donationId":"FFF6A68D-DB19-4CD3-97B0-01C1A793ED3B",
    //   "ngoRegistrationNumber":"D0884B20-385D-489E-A9FD-2B6DBE5FEA43",
    //   "spendId": "1234"
    // }

    for (let donation of donationMap) {
      let donationId = donation[0];
      let donationInfo = donation[1]['Record'];
      //calculate how much of the donation's amount remains available for spending
      let donationAmount = donationInfo['donationAmount'];
      if (donationSpendMap.has(donationId)) {
        spendAmountForDonor = donationSpendMap.get(donationId);
      }
      else {
        spendAmountForDonor = 0;
      }
      let availableAmountForDonor = donationAmount - spendAmountForDonor;
      //if the donation does not have sufficient funds to cover their allocation, then allocate
      //all of the outstanding donation funds
      let amountAllocatedToDonation = 0;
      if (availableAmountForDonor >= spendPerDonation) {
        amountAllocatedToDonation = spendPerDonation;
        console.log('##### allocateSpend - donation ID ' + donationId + ' has sufficient funds to cover full allocation. Allocating: ' + amountAllocatedToDonation);
      }
      else if (availableAmountForDonor > 0) {
        amountAllocatedToDonation = availableAmountForDonor;
        // reduce the number of donations available since this donation record is fully allocated
        numberOfDonations -= 1;
        console.log('##### allocateSpend - donation ID ' + donationId + ' does not have sufficient funds to cover full allocation. Using all available funds: ' + amountAllocatedToDonation);
      }
      else {
        // reduce the number of donations available since this donation record is fully allocated
        numberOfDonations -= 1;
        console.log('##### allocateSpend - donation ID ' + donationId + ' has no funds available at all. Available amount: ' + availableAmountForDonor + '. This donation ID will be ignored');
        continue;
      }
      // add a new spendAllocation record containing the portion of a donation allocated to this spend
      //
      // spendAllocationId is (hopefully) using an ID created in a deterministic manner, meaning it should
      // be identical on all endorsing peer nodes. If it isn't, the transaction validation process will fail
      // when Fabric compares the write-sets for each transaction and discovers there is are different values.
      let spendAllocationId = stub.getTxID() + '-' + recordCounter;
      recordCounter++;
      let key = 'spendAllocation' + spendAllocationId;
      let spendAllocationRecord = {
        docType: 'spendAllocation',
        spendAllocationId: spendAllocationId,
        spendAllocationAmount: amountAllocatedToDonation,
        spendAllocationDate: spend['spendDate'],
        spendAllocationDescription: spend['spendDescription'],
        donationId: donationId,
        ngoRegistrationNumber: ngo,
        spendId: spend['spendId']
      }; 

      console.log('##### allocateSpend - creating spendAllocationRecord record: ' + JSON.stringify(spendAllocationRecord));
      await stub.putState(key, Buffer.from(JSON.stringify(spendAllocationRecord)));

      //reduce the total spend amount by the amount just spent in the NGOSpendDonationAllocation record
      spendAmount -= amountAllocatedToDonation;

      //update the spending map entry for this NGO. There may be no existing spend, in which case we'll create an entry in the map
      if (donationSpendMap.has(donationId)) {
        let spendAmt = donationSpendMap.get(donationId);
        spendAmt += amountAllocatedToDonation;
        donationSpendMap.set(donationId, spendAmt);
        console.log('##### allocateSpend - donationSpendMap - updating spend entry for donation Id: ' + donationId + ' with spent amount allocated to donation: ' + amountAllocatedToDonation + ' - total amount of this donation now spent is: ' + spendAmt);
      }
      else {
        donationSpendMap.set(donationId, amountAllocatedToDonation);
        console.log('##### allocateSpend - donationSpendMap - adding new spend entry for donation ID: ' + donationId + ' with spent amount allocated to donation: ' + amountAllocatedToDonation);
      }
    }
  }
  console.log('============= END : allocateSpend ===========');
}  

/************************************************************************************************
 * 
 * CHAINCODE
 * 
 ************************************************************************************************/

let Chaincode = class {

  /**
   * Initialize the state when the chaincode is either instantiated or upgraded
   * 
   * @param {*} stub 
   */
  async Init(stub) {
    console.log('=========== Init: Instantiated / Upgraded ngo chaincode ===========');
    return shim.success();
  }

  /**
   * The Invoke method will call the methods below based on the method name passed by the calling
   * program.
   * 
   * @param {*} stub 
   */
  async Invoke(stub) {
    console.log('============= START : Invoke ===========');
    let ret = stub.getFunctionAndParameters();
    console.log('##### Invoke args: ' + JSON.stringify(ret));

    let method = this[ret.fcn];
    if (!method) {
      console.error('##### Invoke - error: no chaincode function with name: ' + ret.fcn + ' found');
      throw new Error('No chaincode function with name: ' + ret.fcn + ' found');
    }
    try {
      let response = await method(stub, ret.params);
      console.log('##### Invoke response payload: ' + response);
      return shim.success(response);
    } catch (err) {
      console.log('##### Invoke - error: ' + err);
      return shim.error(err);
    }
  }

  /**
   * Initialize the state. This should be explicitly called if required.
   * 
   * @param {*} stub 
   * @param {*} args 
   */
  async initLedger(stub, args) {
    console.log('============= START : Initialize Ledger ===========');
    console.log('============= END : Initialize Ledger ===========');
  }

  /************************************************************************************************
   * 
   * IoT functions 
   * 
   ************************************************************************************************/

   /**
   * Creates a new donor
   * 
   * @param {*} stub 
   * @param {*} args - JSON as follows:
   * {
   *    "donorUserName":"edge",
   *    "email":"edge@abc.com",
   *    "registeredDate":"2018-10-22T11:52:20.182Z"
   * }
   */
  // async createDonor(stub, args) {
  //   console.log('============= START : createDonor ===========');
  //   console.log('##### createDonor arguments: ' + JSON.stringify(args));

  //   // args is passed as a JSON string
  //   let json = JSON.parse(args);
  //   let key = 'donor' + json['donorUserName'];
  //   json['docType'] = 'donor';

  //   console.log('##### createDonor payload: ' + JSON.stringify(json));

  //   // Check if the donor already exists
  //   let donorQuery = await stub.getState(key);
  //   if (donorQuery.toString()) {
  //     throw new Error('##### createDonor - This donor already exists: ' + json['donorUserName']);
  //   }

  //   await stub.putState(key, Buffer.from(JSON.stringify(json)));
  //   console.log('============= END : createDonor ===========');
  // }
async createIotDevice(stub, args) {
    console.log('============= START : createIotDevice ===========');
    console.log('##### createIotDevice arguments: ' + JSON.stringify(args));

    // Parse the JSON argument 
    let json = JSON.parse(args);

    // Append device type to key
    let key = 'IoTDevice' + json['deviceId'];

    // Set the document type
    json['docType'] = 'iot_device';

    console.log('##### createIotDevice payload: ' + JSON.stringify(json));

    // Check if the device already exists
    let deviceQuery = await stub.getState(key);
    if (deviceQuery.toString()) {
        throw new Error('##### createIotDevice - This device already exists: ' + json['deviceId']);
    }

    // Store the device in the ledger
    await stub.putState(key, Buffer.from(JSON.stringify(json)));
    console.log('============= END : createIotDevice ===========');
}

  /**
   * Retrieves a specfic IoT device Id
   * 
   * @param {*} stub 
   * @param {*} args 
   */
async queryIoTDevice(stub, args) {
    console.log('============= START : queryIoTDevice ===========');
    console.log('##### queryIoTDevice arguments: ' + JSON.stringify(args));

    // Parse the JSON argument 
    let json = JSON.parse(args);

    // Append device ID to key
    let key = 'IoTDevice' + json['deviceId'];

    console.log('##### queryIoTDevice key: ' + key);

    // Query the device by key
    let deviceQuery = await stub.getState(key);

    // Throw error if device does not exist
    if (!deviceQuery.toString()) {
        throw new Error('##### queryIoTDevice - This device does not exist: ' + json['deviceId']);
    }

    // Return queried device information
    console.log('============= END : queryIoTDevice ===========');
    return deviceQuery;
}

  /**
   * Retrieves all donors
   * 
   * @param {*} stub 
   * @param {*} args 
   */
  async  queryAllIoTDevices(stub, args) {
    console.log('============= START : queryAllIoTDevices ===========');
    console.log('##### queryAllIoTDevices arguments: ' + JSON.stringify(args));
 
    let queryString = '{"selector": {"docType": "iot_device"}}';
    return queryByString(stub, queryString);
  }

  /************************************************************************************************
   * 
   * NGO functions 
   * 
   ************************************************************************************************/


  /**
   * Creates a new Donation
   * 
   * @param {*} stub 
   * @param {*} args - JSON as follows:
   * {
   *    "donationId":"2211",
   *    "donationAmount":100,
   *    "donationDate":"2018-09-20T12:41:59.582Z",
   *    "donorUserName":"edge",
   *    "ngoRegistrationNumber":"6322"
   * }
   */
  // async createDonation(stub, args) {
  //   console.log('============= START : createDonation ===========');
  //   console.log('##### createDonation arguments: ' + JSON.stringify(args));

  //   // args is passed as a JSON string
  //   let json = JSON.parse(args);
  //   let key = 'donation' + json['donationId'];
  //   json['docType'] = 'donation';

  //   console.log('##### createDonation donation: ' + JSON.stringify(json));

  //   // Confirm the NGO exists
  //   let ngoKey = 'ngo' + json['ngoRegistrationNumber'];
  //   let ngoQuery = await stub.getState(ngoKey);
  //   if (!ngoQuery.toString()) {
  //     throw new Error('##### createDonation - Cannot create donation as the NGO does not exist: ' + json['ngoRegistrationNumber']);
  //   }

  //   // Confirm the donor exists
  //   let donorKey = 'donor' + json['donorUserName'];
  //   let donorQuery = await stub.getState(donorKey);
  //   if (!donorQuery.toString()) {
  //     throw new Error('##### createDonation - Cannot create donation as the Donor does not exist: ' + json['donorUserName']);
  //   }

  //   // Check if the Donation already exists
  //   let donationQuery = await stub.getState(key);
  //   if (donationQuery.toString()) {
  //     throw new Error('##### createDonation - This Donation already exists: ' + json['donationId']);
  //   }

  //   await stub.putState(key, Buffer.from(JSON.stringify(json)));
  //   console.log('============= END : createDonation ===========');
  // }
async createDataUpdate(stub, args) {
    console.log('============= START : createDataUpdate ===========');
    console.log('##### createDataUpdate arguments: ' + JSON.stringify(args));
    let json = JSON.parse(args);
    let key = 'dataUpdate' + json['updateId'];
    // Set the document type
    json['docType'] = 'data_update';
    console.log('##### createDataUpdate payload: ' + JSON.stringify(json));
    // Check if the device already exists
    let deviceKey = 'IoTDevice' + json['deviceId'];
    let deviceQuery = await stub.getState(deviceKey);
    if (!deviceQuery.toString()) {
        throw new Error('##### createDataUpdate - Cannot create data update as the device does not exist: ' + json['deviceId']);
    }

    // Check if the data update already exists
    let dataUpdateQuery = await stub.getState(key);
    if (dataUpdateQuery.toString()) {
        throw new Error('##### createDataUpdate - This data update already exists: ' + json['updateId']);
    }

    // Store the data update in the ledger
    await stub.putState(key, Buffer.from(JSON.stringify(json)));
    console.log('============= END : createDataUpdate ===========');
}

  /**
   * Retrieves a specfic donation
   * 
   * @param {*} stub 
   * @param {*} args 
   */
  async queryIoTDataUpdate(stub, args) {
   
  
    console.log('============= START : queryDataUpdate ===========');
    console.log('##### queryDataUpdate arguments: ' + JSON.stringify(args));
  
    // args is passed as a JSON string
    let json = JSON.parse(args);
    let key = 'dataUpdate' + json['updateId'];
    console.log('##### queryDataUpdate key: ' + key);
    
    return queryByKey(stub, key);
  }

  /**
   * Retrieves donations for a specfic donor
   * 
   * @param {*} stub 
   * @param {*} args 
   */
  async queryUpdatesForDevice(stub, args) {
  console.log('============= START : queryUpdatesForDevice ===========');
  console.log('##### queryUpdatesForDevice arguments: ' + JSON.stringify(args));
  // args is passed as a JSON string
  let json = JSON.parse(args);
  let queryString = '{"selector": {"docType": "dataUpdate", "deviceId": "' + json['deviceId'] + '"}}';
  return queryByString(stub, queryString);
}

  /**
   * Retrieves all donations
   * 
   * @param {*} stub 
   * @param {*} args 
   */
  async queryAllUpdates(stub, args) {
  console.log('============= START : queryAllUpdates ===========');
  console.log('##### queryAllUpdates arguments: ' + JSON.stringify(args));
  let queryString = '{"selector": {"docType": "dataUpdate"}}';
  return queryByString(stub, queryString);
}
}
shim.start(new Chaincode());