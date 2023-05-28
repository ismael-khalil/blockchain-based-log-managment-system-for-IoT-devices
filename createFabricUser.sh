

# This script registers and enrolls the user within the Fabric CA.  It then uploads the generated credentials to AWS Secrets Manager.
export CERTS_FOLDER=/tmp/certs
export PATH=$PATH:/home/ec2-user/go/src/github.com/hyperledger/fabric-ca/bin

# Register and enroll
fabric-ca-client register --id.name $FABRICUSER --id.affiliation $MEMBERNAME --tls.certfiles /home/ec2-user/managedblockchain-tls-chain.pem --id.type user --id.secret $FABRICUSERPASSWORD
fabric-ca-client enroll -u https://$FABRICUSER:$FABRICUSERPASSWORD@$CASERVICEENDPOINT --tls.certfiles /home/ec2-user/managedblockchain-tls-chain.pem -M $CERTS_FOLDER/$FABRICUSER

# Put the credentials on Secrets Manager
aws secretsmanager create-secret --name "dev/fabricOrgs/$MEMBERNAME/$FABRICUSER/pk" --secret-string "`cat $CERTS_FOLDER/$FABRICUSER/keystore/*`" --region $REGION
aws secretsmanager create-secret --name "dev/fabricOrgs/$MEMBERNAME/$FABRICUSER/signcert" --secret-string "`cat $CERTS_FOLDER/$FABRICUSER/signcerts/*`" --region $REGION