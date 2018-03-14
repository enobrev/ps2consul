# ps-to-consul
Syncs Parameter Store to local Consul service

This is mostly a collection of scripts for downloading parameters from Parameter Store.  It also includes a process that will listen for SNS messages about Parameter Store changes, and then update a local consul kv client with the values that were changed.

This library is not yet generalized, as it's currently being used by a single project.

The expected structure of the Parameter Store vars is:

```
[ENVIRONMENT]/[APP]/path/to/var   // App-specific vars
[ENVIRONMENT]/shared/path/to/var  // "Global" vars
deploy/path/to/var                // vars for a deploy server that lives outside of the environment

```

This library _should_ work just fine with Parameter Store values that have been encrypted with kms provided the profile you're using has its permissions set up properly.

