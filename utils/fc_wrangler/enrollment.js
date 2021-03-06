//-------------------------------------------------------------------
// Enrollment HFC Library
//-------------------------------------------------------------------

module.exports = function (logger) {
	var HFC = require('fabric-client');
	var path = require('path');
	var common = require(path.join(__dirname, './common.js'))(logger);
	var enrollment = {};
	var User = require('fabric-client/lib/User.js');
	var CaService = require('fabric-ca-client/lib/FabricCAClientImpl.js');
	var Orderer = require('fabric-client/lib/Orderer.js');
	var Peer = require('fabric-client/lib/Peer.js');


	//-----------------------------------------------------------------
	// Enroll an enrollId with the ca
	//-----------------------------------------------------------------
	/*
		options = {
			peer_urls: ['array of peer grpc urls'],
			channel_id: 'channel name',
			uuid: 'unique name for this enollment',
			ca_url: 'http://urlhere:port',
			orderer_url: 'grpc://urlhere:port',
			enroll_id: 'enrollId',
			enroll_secret: 'enrollSecret',
			msp_id: 'string'
		}
	*/

	enrollment.enroll = function (options, cb) {
		var chain = {};
		var client = null;
		try {
			client = new HFC();
			chain = client.newChain(options.channel_id);
		}
		catch (e) {
			//it might error about 1 chain per network, but that's not a problem just continue
		}

		if (!options.uuid) {
			logger.error('cannot enroll with undefined uuid');
			if (cb) cb({ error: 'cannot enroll with undefined uuid' });
			return;
		}

		console.log('');
		logger.info('[fcw] Going to enroll for mspId ', options);

		// Make eCert kvs (Key Value Store)
		HFC.newDefaultKeyValueStore({
			path: path.join(__dirname, '/kvs/' + options.uuid)	//store eCert in the kvs directory
		}).then(function (store) {
			client.setStateStore(store);
			return getSubmitter(client, options);				//do most of the work here
		}).then(function (submitter) {

			chain.addOrderer(new Orderer(options.orderer_url));

			try {
				for (var i in options.peer_urls) {
					chain.addPeer(new Peer(options.peer_urls[i]));
					logger.debug('added peer', options.peer_urls[i]);
				}
			}
			catch (e) {
				//might error if peer already exists, but we don't care
			}
			try{
				chain.setPrimaryPeer(new Peer(options.peer_urls[0]));
				logger.debug('added primary peer', options.peer_urls[0]);
			}
			catch(e){
				//might error b/c bugs, don't care
			}

			// --- Success --- //
			logger.debug('[fcw] Successfully got enrollment ' + options.uuid);
			if (cb) cb(null, { chain: chain, submitter: submitter });
			return;

		}).catch(

			// --- Failure --- //
			function (err) {
				logger.error('[fcw] Failed to get enrollment ' + options.uuid, err.stack ? err.stack : err);
				var formatted = common.format_error_msg(err);
				if (cb) cb(formatted);
				return;
			}
			);
	};

	// Get Submitter - ripped this function off from helper.js in fabric-client
	function getSubmitter(client, options) {
		var member;
		return client.getUserContext(options.enroll_id)
			.then((user) => {
				if (user && user.isEnrolled()) {
					logger.info('[fcw] Successfully loaded member from persistence');
					return user;
				} else {

					// Need to enroll it with CA server
					var ca_client = new CaService(options.ca_url);
					logger.debug('id', options.enroll_id, 'secret', options.enroll_secret);					//dsh todo remove this
					logger.debug('msp_id', options.msp_id);
					return ca_client.enroll({
						enrollmentID: options.enroll_id,
						enrollmentSecret: options.enroll_secret

						// Store Certs
					}).then((enrollment) => {
						logger.info('[fcw] Successfully enrolled user \'' + options.enroll_id + '\'');
						member = new User(options.enroll_id, client);

						return member.setEnrollment(enrollment.key, enrollment.certificate, options.msp_id);

						// Save Submitter Enrollment
					}).then(() => {
						return client.setUserContext(member);

						// Return Submitter Enrollment
					}).then(() => {
						return member;

						// Send Errors to Callback
					}).catch((err) => {
						logger.error('[fcw] Failed to enroll and persist user. Error: ' + err.stack ? err.stack : err);
						throw new Error('Failed to obtain an enrolled user');
					});
				}
			});
	}

	return enrollment;
};
