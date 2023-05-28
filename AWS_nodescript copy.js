const AWS = require('aws-sdk');
const ManagedBlockchain = require('aws-sdk/clients/managedblockchain');
//#Step2: authentication & configuration
AWS.config.update({
  accessKeyId: 'your-access-key-id',
  secretAccessKey: 'your-secret-access-key',
  region: 'eu-west-1'
});
//Step3: create S3 bucket & AWS IoT thing type & obect  
const s3 = new AWS.S3();
const iot = new AWS.Iot();
const lambda = new AWS.Lambda();
const cloudtrail = new AWS.CloudTrail();
const BUCKET_NAME = 'iot-blockchain-logs';

s3.createBucket({ Bucket: BUCKET_NAME }, function(err, data) {
  if (err) {
    console.log(err);
  } else {
    console.log('Bucket created successfully');
  }
});
const THING_NAME = 'virtual-temp';
const THING_TYPE_NAME = 'virtual-temp-devices';
const THING_POLICY_NAME = 'virtual-device-policy';

iot.createThing({ thingName: THING_NAME, thingTypeName: THING_TYPE_NAME, attributePayload: { attributes: { key: 'value' } } }, function(err, data) {
  if (err) {
    console.log(err);
  } else {
    console.log('Thing created successfully');
  }
});
iot.createPolicy({ policyName: THING_POLICY_NAME, policyDocument: '{"Version": "2012-10-17","Statement": [{"Effect": "Allow","Action": "iot:*","Resource": "*"}]}' }, function(err, data) {
  if (err) {
    console.log(err);
  } else {
    console.log('Policy created successfully');
  }
});

iot.attachPolicy({ policyName: THING_POLICY_NAME, target: THING_NAME }, function(err, data) {
  if (err) {
    console.log(err);
  } else {
    console.log('Policy attached successfully');
  }
});

iot.createKeysAndCertificate({ setAsActive: true, certificatePemOutfile: 'device-cert.pem', publicKeyOutfile: 'public-key.pem', privateKeyOutfile: 'private-key.pem' }, function(err, data) {
  if (err) {
    console.log(err);
  } else {
    console.log('Keys and certificate created successfully');
  }
});

//#Step4 create a lambda function to simulate temperature sensor & schedule it to work every 10 mintues
const LAMBDA_ROLE_ARN = '<iam-role-arn>';
const LAMBDA_ENDPOINT = '<iot-endpoint>';

const lambdaParams = {
  FunctionName: 'MyTemperatureSensor',
  Runtime: 'nodejs14.x',
  Role: LAMBDA_ROLE_ARN,
  Handler: 'index.handler',
  Code: { ZipFile: fs.readFileSync('./function.zip') },
  Environment: { Variables: { IOT_ENDPOINT: LAMBDA_ENDPOINT } }
};

lambda.createFunction(lambdaParams, function(err, data) {
  if (err) {
    console.log(err);
  } else {
    console.log('Lambda function created successfully');
  }
});

const updateParams = {
  FunctionName: 'MyTemperatureSensor',
  Environment: { Variables: { IOT_ENDPOINT: LAMBDA_ENDPOINT } }
};

lambda.updateFunctionConfiguration(updateParams, function(err, data) {
  if (err) {
    console.log(err);
  } else {
    console.log('Lambda function configuration updated successfully');
  }
});

const updateCodeParams = {
  FunctionName: 'MyTemperatureSensor',
  ZipFile: fs.readFileSync('./function.zip')
};

lambda.updateFunctionCode(updateCodeParams, function(err, data) {
  if (err) {
    console.log(err);
  } else {
    console.log('Lambda function code updated successfully');
  }
});

//#Step4 create a lambda function to simulate temperature sensor & schedule it to work every 10 mintues

const CLOUDTRAIL_NAME = 'cloudtrailroleforiot-blockchain-trail';

cloudtrail.createTrail({ Name: '<trail-name>', S3BucketName: '<bucket-name>', IsMultiRegionTrail: true, IncludeGlobalServiceEvents: true, EnableLogFileValidation: true, IsOrganizationTrail: false }, function(err, data) {
  if (err) {
    console.log(err);
  } else {
    console.log('CloudTrail created successfully');
  }
});

cloudtrail.startLogging({ Name: CLOUDTRAIL_NAME }, function(err, data) {
  if (err) {
    console.log(err);
  } else {
    console.log('CloudTrail logging started successfully');
  }
});

//Replace the `aws managedblockchain` commands with the following code:
//part2: create a blockchain network
const NETWORK_NAME = 'iot-blockchain-network';
const MEMBER_NAME = 'iot-blockchain-keeper';
const PEER_NAME = 'iot-blockchain-peer';
const CHANNEL_NAME = 'iot-blockchain-channel';
const CHAINCODE_NAME = 'my-chaincode';
const CHAINCODE_VERSION = '1.0';
const CHAINCODE_SRC_DIR = '/path/to/chaincode/src';
const TOKEN = '<token>';

const managedBlockchain = new ManagedBlockchain();
managedBlockchain.createNetwork({
    ClientRequestToken: TOKEN,
    Name: NETWORK_NAME,
    Framework: "HYPERLEDGER_FABRIC",
    FrameworkVersion: "1.2",
    FrameworkConfiguration: {
      Fabric: {
        Edition: "STARTER"
      }
    },
    VotingPolicy: {
      ApprovalThresholdPolicy: {
        ThresholdPercentage: 100,
        ProposalDurationInHours: 24,
        ThresholdComparator: "GREATER_THAN_OR_EQUAL_TO"
      }
    },
    MemberConfiguration: {
      Name: MEMBER_NAME
    },
    Tags: [
      {
        Key: "Name",
        Value: NETWORK_NAME
      }
    ]
  }, function(err, data) {
    if (err) {
      console.log("Error creating network:", err);
    } else {
      const NETWORK_ID = data.NetworkId;
  
      managedBlockchain.listMembers({ NetworkId: NETWORK_ID }, function(err, data) {
        if (err) {
          console.log(err);
        } else {
          const MEMBER_ID = data.Members.filter(member => member.Name.includes(MEMBER_NAME))[0].Id;
  
          managedBlockchain.createNode(
            {
              ClientRequestToken: TOKEN,
              NetworkId: NETWORK_ID,
              MemberId: MEMBER_ID,
              NodeConfiguration:
                '{"PeerNodeConfiguration": {"PeerEndpointType": "NODE", "AvailabilityZone": "us-east-1a"}}',
              PeerRole: "MEMBER",
              Tags: [{ Key: "Name", Value: PEER_NAME }],
            },
            function(err, data) {
              if (err) {
                console.log(err);
              } else {
                const PEER_NODE = data.Node;
  
                const createChannelParams = {
                  Actions: [
                    {
                      Name: "createChannel",
                      Parameters: {
                        Fabric: {
                          ChannelName: CHANNEL_NAME,
                          ChannelConfiguration: {
                            Capabilities: { V2_0: {} },
                            Policy: {
                              Type: "Signature",
                              Rule: "OR('" + MEMBER_NAME + "'.member')",
                            },
                            Consortium: "defaultconsortium",
                          },
                        },
                      },
                    },
                  ],
                  ClientRequestToken: TOKEN,
                  MemberId: MEMBER_ID,
                  NetworkId: NETWORK_ID,
                };
  
                createProposal(createChannelParams);
              }
            }
          );
        }
      });
    }
  });
  
  function voteOnProposal(proposalId, networkId, memberId, vote) {
    managedBlockchain.voteOnProposal(
      { ProposalId: proposalId, NetworkId: networkId, MemberId: memberId, Vote: vote },
      function(err, data) {
        if (err) {
          console.log(err);
        } else {
          console.log("Managed Blockchain proposal voted on successfully");
        }
      }
    );
  }
  
  function createProposal(params) {
    managedBlockchain.createProposal(params, function(err, data) {
      if (err) {
        console.log(err);
      } else {
        console.log("Managed Blockchain proposal created successfully");
        setTimeout(function () {
          voteOnProposal(data.ProposalId, params.NetworkId, params.MemberId, "YES");
        }, 30000);
      }
    });
  }
  